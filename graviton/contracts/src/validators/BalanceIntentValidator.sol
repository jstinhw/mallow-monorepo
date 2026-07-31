// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IInteropValidator} from "../interfaces/IInteropValidator.sol";
import {Order} from "../types/Structs.sol";

contract BalanceIntentValidator is IInteropValidator {
    mapping(bytes32 => uint256) public _balanceIntent;

    function validate(Order calldata order, bytes calldata data) external returns (bool) {
        uint256 amount;
        assembly {
            amount := calldataload(data.offset)
        }

        bytes32 hash = _getHash(order.sender, order.targetIntent.chainId, order.targetIntent.nonce);

        uint256 currentBalance;
        unchecked {
            currentBalance = _balanceIntent[hash] + order.targetIntent.amount;
        }
        _balanceIntent[hash] = currentBalance;

        return currentBalance >= amount;
    }

    function _getHash(address _sender, uint256 _targetChainId, uint256 _nonce) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(_sender, _targetChainId, _nonce));
    }
}
