// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IMessageTransmitterV2 {
    function receiveMessage(bytes calldata message, bytes calldata signature) external returns (bool success);
}
