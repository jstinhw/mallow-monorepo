// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ILayerZeroReceiver, Origin} from "../interfaces/layerzero/ILayerZeroReceiver.sol";
import {IInteropExecutor} from "../interfaces/IInteropExecutor.sol";
import {Order} from "../types/Structs.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";

contract LayerZeroAdapterSimulation is ILayerZeroReceiver {
    address public immutable LZ_ENDPOINT;
    IInteropExecutor public immutable INTEROP_EXECUTOR;

    error NotEndpoint();
    error NotPeer();

    constructor(address lzEndpoint, address interopExecutor) {
        LZ_ENDPOINT = lzEndpoint;
        INTEROP_EXECUTOR = IInteropExecutor(interopExecutor);
    }

    receive() external payable {}

    function lzReceive(Origin calldata _origin, bytes32, bytes calldata _message, address, bytes calldata)
        external
        payable
        override
    {
        if (msg.sender != LZ_ENDPOINT) revert NotEndpoint();
        if (_origin.sender != bytes32(uint256(uint160(address(this))))) revert NotPeer();

        Order memory order = abi.decode(_message, (Order));

        SafeTransferLib.safeApprove(order.targetIntent.token, address(INTEROP_EXECUTOR), order.targetIntent.amount);
        try INTEROP_EXECUTOR.fill(order, order.targetIntent.token, order.targetIntent.amount) {}
        catch (bytes memory data) {
            if (bytes4(data) != IInteropExecutor.InvalidSignature.selector) {
                assembly {
                    revert(add(data, 0x20), mload(data))
                }
            }
        }
    }

    function allowInitializePath(Origin calldata _origin) external view override returns (bool) {
        return _origin.sender == bytes32(uint256(uint160(address(this))));
    }

    function nextNonce(uint32, bytes32) external pure override returns (uint64) {
        return 0;
    }
}
