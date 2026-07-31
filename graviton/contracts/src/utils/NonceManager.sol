// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

struct Nonce {
    mapping(address => mapping(uint160 => uint96)) nonce;
}

library NonceManager {
    function increment(Nonce storage s, address _user, uint160 _key) internal returns (uint256) {
        return uint256(bytes32(abi.encodePacked(_key, s.nonce[_user][_key]++)));
    }

    function getNonce(Nonce storage s, address _user, uint160 _key) internal view returns (uint256) {
        return uint256(bytes32(abi.encodePacked(_key, s.nonce[_user][_key])));
    }

    function getNonce(Nonce storage s, address _user) internal view returns (uint256) {
        return getNonce(s, _user, uint160(0));
    }

    function getKey(uint256 _nonce) internal view returns (uint160) {
        return uint160(_nonce >> 96);
    }
}
