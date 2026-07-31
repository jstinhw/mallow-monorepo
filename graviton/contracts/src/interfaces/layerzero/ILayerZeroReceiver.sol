// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

struct Origin {
    uint32 srcEid;
    bytes32 sender;
    uint64 nonce;
}

interface ILayerZeroReceiver {
    function lzReceive(
        Origin calldata _origin,
        bytes32 _guid,
        bytes calldata _message,
        address _executor,
        bytes calldata _extraData
    ) external payable;

    function allowInitializePath(Origin calldata _origin) external view returns (bool);

    function nextNonce(uint32 _eid, bytes32 _sender) external view returns (uint64);
}
