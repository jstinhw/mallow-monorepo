// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC7579Account} from "../../src/interfaces/IERC7579Account.sol";

contract MockAccount is IERC7579Account {
    address public owner;

    function setOwner(address _owner) external {
        owner = _owner;
    }

    receive() external payable {}

    function executeFromExecutor(bytes32, bytes calldata execCallData) external returns (bytes[] memory returnData) {
        address target;
        uint256 value;
        bytes memory callData;

        // Try abi.decode first (used by prehooks and some other calls)
        try this.decodeExecuteData(execCallData) returns (address _target, uint256 _value, bytes memory _callData) {
            target = _target;
            value = _value;
            callData = _callData;
        } catch {
            // Fallback to abi.encodePacked parsing (used by payment tokens and bridge)
            (target, value, callData) = parsePackedData(execCallData);
        }

        bool success;
        bytes memory result;
        (success, result) = target.call{value: value}(callData);
        require(success, "MockAccount execution failed");

        returnData = new bytes[](1);
        returnData[0] = result;
    }

    function decodeExecuteData(bytes calldata data)
        external
        pure
        returns (address target, uint256 value, bytes memory callData)
    {
        (target, value, callData) = abi.decode(data, (address, uint256, bytes));
    }

    function parsePackedData(bytes calldata execCallData)
        internal
        pure
        returns (address target, uint256 value, bytes memory callData)
    {
        require(execCallData.length >= 52, "Invalid execCallData length");

        // Extract address (first 20 bytes)
        assembly {
            target := shr(96, calldataload(execCallData.offset))
        }

        // Extract uint256 (next 32 bytes)
        assembly {
            value := calldataload(add(execCallData.offset, 20))
        }

        // Extract remaining bytes
        callData = execCallData[52:];
    }

    function isValidSignature(bytes32, bytes memory signature) external view returns (bytes4) {
        // We can use a simplified check or actually verify.
        // For this mock, we'll return generic success if signature is "0x1234" (magic for tests)
        // OR we try to recover.

        // Let's actually verify to be robust.
        // But we need ECDSA.
        // We can cheat and always return valid if we want, but better to check.

        // Simplest: Check if signature is empty, if so fail?
        // Or checking if signature equals "PASS"

        if (keccak256(signature) == keccak256(bytes("PASS"))) {
            return 0x1626ba7e;
        }

        return 0xffffffff;
    }
}
