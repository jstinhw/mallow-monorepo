// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ISenderCreator {
    function createSender(bytes calldata initCode) external returns (address sender);
}

ISenderCreator constant SENDER_CREATOR = ISenderCreator(0xEFC2c1444eBCC4Db75e7613d20C6a62fF67A167C);

address constant NATIVE_TOKEN = address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);
