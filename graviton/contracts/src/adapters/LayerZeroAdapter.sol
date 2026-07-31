// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {BaseAdapter} from "./BaseAdapter.sol";
import {ILayerZeroEndpointV2, MessagingParams, MessagingFee} from "../interfaces/layerzero/ILayerZeroEndpointV2.sol";
import {ILayerZeroReceiver, Origin} from "../interfaces/layerzero/ILayerZeroReceiver.sol";
import {IInteropExecutor} from "../interfaces/IInteropExecutor.sol";
import {Order} from "../types/Structs.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";

contract LayerZeroAdapter is BaseAdapter, ILayerZeroReceiver {
    ILayerZeroEndpointV2 public immutable LZ_ENDPOINT;
    IInteropExecutor public immutable INTEROP_EXECUTOR;
    address public immutable LZ_ADAPTER_SIMULATION;

    error InvalidInputAmount();
    error NotEndpoint();
    error NotPeer();
    error InsufficientBalance();

    constructor(address lzEndpoint, address interopExecutor, address lzAdapterSimulation, address delegate) {
        LZ_ENDPOINT = ILayerZeroEndpointV2(lzEndpoint);
        INTEROP_EXECUTOR = IInteropExecutor(interopExecutor);
        LZ_ADAPTER_SIMULATION = lzAdapterSimulation;
        LZ_ENDPOINT.setDelegate(delegate);
    }

    receive() external payable {}

    function _initiateDeposit(address, uint256 _inputAmount, bytes calldata _adapterData, Order calldata _order)
        internal
        override
    {
        if (_inputAmount != 0) revert InvalidInputAmount();

        (uint32 dstEid, bytes memory options, address refundAddress) =
            abi.decode(_adapterData, (uint32, bytes, address));

        bytes memory message = abi.encode(_order);

        MessagingParams memory params = MessagingParams({
            dstEid: dstEid,
            receiver: bytes32(uint256(uint160(address(this)))),
            message: message,
            options: options,
            payInLzToken: false
        });

        LZ_ENDPOINT.send{value: address(this).balance}(params, refundAddress);
    }

    function lzReceive(Origin calldata _origin, bytes32, bytes calldata _message, address, bytes calldata)
        external
        payable
        override
    {
        if (msg.sender != address(LZ_ENDPOINT)) revert NotEndpoint();
        if (_origin.sender != bytes32(uint256(uint160(address(this))))) {
            revert NotPeer();
        }

        Order memory order = abi.decode(_message, (Order));

        uint256 balance = SafeTransferLib.balanceOf(order.targetIntent.token, address(this));
        if (balance < order.targetIntent.amount) revert InsufficientBalance();

        SafeTransferLib.safeApprove(order.targetIntent.token, address(INTEROP_EXECUTOR), balance);
        INTEROP_EXECUTOR.fill(order, order.targetIntent.token, balance);
    }

    function allowInitializePath(Origin calldata _origin) external view override returns (bool) {
        return _origin.sender == bytes32(uint256(uint160(address(this))));
    }

    function nextNonce(uint32, bytes32) external pure override returns (uint64) {
        return 0;
    }

    function quote(uint32 _dstEid, bytes calldata _message, bytes calldata _options)
        external
        view
        returns (MessagingFee memory)
    {
        MessagingParams memory params = MessagingParams({
            dstEid: _dstEid,
            receiver: bytes32(uint256(uint160(LZ_ADAPTER_SIMULATION))),
            message: _message,
            options: _options,
            payInLzToken: false
        });

        return LZ_ENDPOINT.quote(params, address(this));
    }
}
