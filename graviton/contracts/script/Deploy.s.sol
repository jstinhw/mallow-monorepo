// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Script, console} from "forge-std/Script.sol";
import {InteropExecutor} from "../src/InteropExecutor.sol";
import {InteropExecutorSimulation} from "../src/simulations/InteropExecutorSimulation.sol";
import {AcrossAdapter} from "../src/adapters/AcrossAdapter.sol";
import {AcrossAdapterSimulation} from "../src/simulations/AcrossAdapterSimulation.sol";
import {CCTPAdapterSimulation} from "../src/simulations/CCTPAdapterSimulation.sol";
import {CCTPAdapter} from "../src/adapters/CCTPAdapter.sol";
import {LayerZeroAdapter} from "../src/adapters/LayerZeroAdapter.sol";
import {LayerZeroAdapterSimulation} from "../src/simulations/LayerZeroAdapterSimulation.sol";
import {BalanceIntentValidator} from "../src/validators/BalanceIntentValidator.sol";
import {ILayerZeroEndpointV2, SetConfigParam} from "../src/interfaces/layerzero/ILayerZeroEndpointV2.sol";

struct UlnConfig {
    uint64 confirmations;
    uint8 requiredDVNCount;
    uint8 optionalDVNCount;
    uint8 optionalDVNThreshold;
    address[] requiredDVNs;
    address[] optionalDVNs;
}

interface ICreateX {
    function deployCreate3(bytes32 salt, bytes memory initCode) external payable returns (address newContract);

    function computeCreate3Address(bytes32 salt, address deployer) external view returns (address computedAddress);
}

contract DeployScript is Script {
    address constant CREATE_X_ADDRESS = 0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed;
    string constant VERSION = "v0.0.13";

    // LayerZero V2 EndpointV2 — same address on all EVM chains
    address constant LZ_ENDPOINT = 0x1a44076050125825900e736c501f859c50fE728c;

    mapping(string => uint256) public forkIds;

    function runMainnet() public {
        string[] memory chains = new string[](3);
        chains[0] = "base";
        chains[1] = "arbitrum";
        chains[2] = "optimism";
        _deployChains(chains);
    }

    function runTestnet() public {
        string[] memory chains = new string[](2);
        chains[0] = "sepolia";
        chains[1] = "base-sepolia";
        _deployChains(chains);
    }

    function _deployChains(string[] memory chains) internal {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");

        for (uint256 i = 0; i < chains.length; i++) {
            _conditionalFork(chains[i]);
            console.log("Deploying to chain:", chains[i]);

            // Fetch chain-specific addresses
            address spokePool = getSpokePool(chains[i]);
            address wrappedNativeToken = getWrappedNativeToken(chains[i]);

            if (spokePool == address(0)) {
                console.log("SpokePool not found for chain:", chains[i]);
                continue;
            }

            vm.startBroadcast(deployer);

            // // 1. Deploy InteropExecutor
            bytes32 salt = keccak256(abi.encodePacked("interop-executor-", VERSION));
            bytes memory initCode = type(InteropExecutor).creationCode;
            address interopExecutor = _deployCreate3(salt, initCode, deployer);
            console.log("InteropExecutor deployed to:", interopExecutor);

            // 2. Deploy InteropExecutorSimulation
            bytes32 saltSim = keccak256(abi.encodePacked("interop-executor-sim-", VERSION));
            bytes memory initCodeSim = type(InteropExecutorSimulation).creationCode;
            address interopExecutorSimulation = _deployCreate3(saltSim, initCodeSim, deployer);
            console.log("InteropExecutorSimulation deployed to:", interopExecutorSimulation);

            // 3. Deploy AcrossAdapter
            bytes32 saltAdapter = keccak256(abi.encodePacked("across-adapter-", VERSION));
            bytes memory initCodeAdapter = abi.encodePacked(
                type(AcrossAdapter).creationCode, abi.encode(spokePool, interopExecutor, wrappedNativeToken)
            );
            address acrossAdapter = _deployCreate3(saltAdapter, initCodeAdapter, deployer);
            console.log("AcrossAdapter deployed to:", acrossAdapter);

            // 4. Deploy AcrossAdapterSimulation
            bytes32 saltAdapterSim = keccak256(abi.encodePacked("across-adapter-sim-", VERSION));
            bytes memory initCodeAdapterSim = abi.encodePacked(
                type(AcrossAdapterSimulation).creationCode, abi.encode(spokePool, interopExecutor, wrappedNativeToken)
            );
            address acrossAdapterSimulation = _deployCreate3(saltAdapterSim, initCodeAdapterSim, deployer);
            console.log("AcrossAdapterSimulation deployed to:", acrossAdapterSimulation);

            // 5. Deploy BalanceIntentValidator
            bytes32 saltBalanceValidator = keccak256(abi.encodePacked("balance-intent-validator-", VERSION));
            bytes memory initCodeBalanceValidator = type(BalanceIntentValidator).creationCode;
            address balanceIntentValidator = _deployCreate3(saltBalanceValidator, initCodeBalanceValidator, deployer);
            console.log("BalanceIntentValidator deployed to:", balanceIntentValidator);

            // // 6. Deploy CCTPAdapter
            address usdc = getUsdcAddress(chains[i]);
            address tokenMessenger = getTokenMessenger(chains[i]);
            address messageTransmitter = getMessageTransmitter(chains[i]);

            if (usdc != address(0) && tokenMessenger != address(0) && messageTransmitter != address(0)) {
                bytes32 saltCctp = keccak256(abi.encodePacked("cctp-adapter-", VERSION));
                bytes memory initCodeCctp = abi.encodePacked(
                    type(CCTPAdapter).creationCode,
                    abi.encode(usdc, tokenMessenger, messageTransmitter, interopExecutor)
                );
                address cctpAdapter = _deployCreate3(saltCctp, initCodeCctp, deployer);
                console.log("CCTPAdapter deployed to:", cctpAdapter);

                // 7. Deploy CCTPAdapterSimulation
                bytes32 saltCctpSim = keccak256(abi.encodePacked("cctp-adapter-sim-", VERSION));
                bytes memory initCodeCctpSim = abi.encodePacked(
                    type(CCTPAdapterSimulation).creationCode,
                    abi.encode(usdc, tokenMessenger, messageTransmitter, interopExecutor)
                );
                address cctpAdapterSimulation = _deployCreate3(saltCctpSim, initCodeCctpSim, deployer);
                console.log("CCTPAdapterSimulation deployed to:", cctpAdapterSimulation);
            } else {
                console.log("Skipping CCTPAdapter deployment for chain:", chains[i]);
            }

            // 8. Deploy LayerZeroAdapter
            address lzEndpoint = getLzEndpoint(chains[i]);

            if (lzEndpoint != address(0)) {
                // 8. Deploy LayerZeroAdapterSimulation (must deploy first — adapter needs its address)
                bytes32 saltLzSim = keccak256(abi.encodePacked("layerzero-adapter-sim-3-", VERSION));
                bytes memory initCodeLzSim = abi.encodePacked(
                    type(LayerZeroAdapterSimulation).creationCode, abi.encode(lzEndpoint, interopExecutor)
                );
                address lzAdapterSim = _deployCreate3(saltLzSim, initCodeLzSim, deployer);
                console.log("LayerZeroAdapterSimulation deployed to:", lzAdapterSim);

                // 9. Deploy LayerZeroAdapter
                bytes32 saltLz = keccak256(abi.encodePacked("layerzero-adapter-3-", VERSION));
                bytes memory initCodeLz = abi.encodePacked(
                    type(LayerZeroAdapter).creationCode, abi.encode(lzEndpoint, interopExecutor, lzAdapterSim, deployer)
                );
                address lzAdapter = _deployCreate3(saltLz, initCodeLz, deployer);
                console.log("LayerZeroAdapter deployed to:", lzAdapter);

                // 10. Configure LZ ULN with minimum confirmations (1 block)
                _configureLzUln(chains[i], lzAdapter);
            } else {
                console.log("Skipping LayerZeroAdapter deployment for chain:", chains[i]);
            }

            vm.stopBroadcast();
        }
    }

    function _conditionalFork(string memory _chain) internal {
        if (forkIds[_chain] == 0) {
            forkIds[_chain] = vm.createSelectFork(_chain);
        } else {
            vm.selectFork(forkIds[_chain]);
        }
    }

    function _deployCreate3(bytes32 salt, bytes memory initCode, address deployer) internal returns (address) {
        address calculated = ICreateX(CREATE_X_ADDRESS).computeCreate3Address(salt, deployer);
        if (calculated.code.length == 0) {
            return ICreateX(CREATE_X_ADDRESS).deployCreate3(salt, initCode);
        }
        return calculated;
    }

    function getSpokePool(string memory chain) internal pure returns (address) {
        bytes32 h = keccak256(bytes(chain));
        if (h == keccak256("base")) {
            return 0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64;
        }
        if (h == keccak256("arbitrum")) {
            return 0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A;
        }
        if (h == keccak256("optimism")) {
            return 0x6f26Bf09B1C792e3228e5467807a900A503c0281;
        }
        if (h == keccak256("sepolia")) {
            return 0x5ef6C01E11889d86803e0B23e3cB3F9E9d97B662;
        }
        if (h == keccak256("base-sepolia")) {
            return 0x82B564983aE7274c86695917BBf8C99ECb6F0F8F;
        }
        return address(0);
    }

    function getWrappedNativeToken(string memory chain) internal pure returns (address) {
        bytes32 h = keccak256(bytes(chain));
        if (h == keccak256("base")) {
            return 0x4200000000000000000000000000000000000006;
        }
        if (h == keccak256("arbitrum")) {
            return 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1;
        }
        if (h == keccak256("optimism")) {
            return 0x4200000000000000000000000000000000000006;
        }
        if (h == keccak256("sepolia")) {
            return 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
        }
        if (h == keccak256("base-sepolia")) {
            return 0x4200000000000000000000000000000000000006;
        }
        return address(0);
    }

    function getUsdcAddress(string memory chain) internal pure returns (address) {
        bytes32 h = keccak256(bytes(chain));
        if (h == keccak256("base")) {
            return 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
        }
        if (h == keccak256("arbitrum")) {
            return 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;
        }
        if (h == keccak256("optimism")) {
            return 0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85;
        }
        if (h == keccak256("sepolia")) {
            return 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
        }
        if (h == keccak256("base-sepolia")) {
            return 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
        }
        return address(0);
    }

    function getTokenMessenger(string memory chain) internal pure returns (address) {
        bytes32 h = keccak256(bytes(chain));
        // Mainnet addresses
        if (h == keccak256("base") || h == keccak256("arbitrum") || h == keccak256("optimism")) {
            return 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d;
        }
        // Testnet addresses
        if (h == keccak256("sepolia") || h == keccak256("base-sepolia")) {
            return 0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5;
        }
        return address(0);
    }

    function getMessageTransmitter(string memory chain) internal pure returns (address) {
        bytes32 h = keccak256(bytes(chain));
        // Mainnet addresses
        if (h == keccak256("base") || h == keccak256("arbitrum") || h == keccak256("optimism")) {
            return 0x81D40F21F12A8F0E3252Bccb954D722d4c464B64;
        }
        // Testnet addresses
        if (h == keccak256("sepolia") || h == keccak256("base-sepolia")) {
            return 0x7865fAfC2db2093669d92c0F33AeEF291086BEFD;
        }
        return address(0);
    }

    function getLzEndpoint(string memory chain) internal pure returns (address) {
        bytes32 h = keccak256(bytes(chain));
        // Same EndpointV2 address on all supported mainnet chains
        if (h == keccak256("base") || h == keccak256("arbitrum") || h == keccak256("optimism")) {
            return LZ_ENDPOINT;
        }
        return address(0);
    }

    // LZ V2 ULN config type
    uint32 constant ULN_CONFIG_TYPE = 2;
    // Minimum block confirmations for fastest delivery
    uint64 constant MIN_CONFIRMATIONS = 1;

    // LZ V2 endpoint IDs
    uint32 constant EID_OPTIMISM = 30111;
    uint32 constant EID_BASE = 30184;
    uint32 constant EID_ARBITRUM = 30110;

    function _configureLzUln(string memory chain, address lzAdapter) internal {
        ILayerZeroEndpointV2 endpoint = ILayerZeroEndpointV2(LZ_ENDPOINT);
        bytes32 h = keccak256(bytes(chain));

        uint32[] memory remoteEids = _getRemoteEids(h);
        address sendLib = _getSendLib(h);
        address receiveLib = _getReceiveLib(h);
        address[] memory dvns = _getDvns(h);

        bytes memory ulnConfig = abi.encode(
            UlnConfig({
                confirmations: MIN_CONFIRMATIONS,
                requiredDVNCount: uint8(dvns.length),
                optionalDVNCount: 0,
                optionalDVNThreshold: 0,
                requiredDVNs: dvns,
                optionalDVNs: new address[](0)
            })
        );

        // Build config params for all remote EIDs
        SetConfigParam[] memory sendParams = new SetConfigParam[](remoteEids.length);
        SetConfigParam[] memory receiveParams = new SetConfigParam[](remoteEids.length);
        for (uint256 i = 0; i < remoteEids.length; i++) {
            sendParams[i] = SetConfigParam({eid: remoteEids[i], configType: ULN_CONFIG_TYPE, config: ulnConfig});
            receiveParams[i] = SetConfigParam({eid: remoteEids[i], configType: ULN_CONFIG_TYPE, config: ulnConfig});
        }

        endpoint.setConfig(lzAdapter, sendLib, sendParams);
        endpoint.setConfig(lzAdapter, receiveLib, receiveParams);

        console.log("LZ ULN configured with 1-block confirmations for", chain);
    }

    function _getRemoteEids(bytes32 h) internal pure returns (uint32[] memory) {
        uint32[] memory eids = new uint32[](2);
        if (h == keccak256("optimism")) {
            eids[0] = EID_BASE;
            eids[1] = EID_ARBITRUM;
        } else if (h == keccak256("base")) {
            eids[0] = EID_OPTIMISM;
            eids[1] = EID_ARBITRUM;
        } else {
            eids[0] = EID_OPTIMISM;
            eids[1] = EID_BASE;
        }
        return eids;
    }

    function _getSendLib(bytes32 h) internal pure returns (address) {
        if (h == keccak256("optimism")) {
            return 0x1322871e4ab09Bc7f5717189434f97bBD9546e95;
        }
        if (h == keccak256("base")) {
            return 0xB5320B0B3a13cC860893E2Bd79FCd7e13484Dda2;
        }
        return 0x975bcD720be66659e3EB3C0e4F1866a3020E493A; // arbitrum
    }

    function _getReceiveLib(bytes32 h) internal pure returns (address) {
        if (h == keccak256("optimism")) {
            return 0x3c4962Ff6258dcfCafD23a814237B7d6Eb712063;
        }
        if (h == keccak256("base")) {
            return 0xc70AB6f32772f59fBfc23889Caf4Ba3376C84bAf;
        }
        return 0x7B9E184e07a6EE1aC23eAe0fe8D6Be2f663f05e6; // arbitrum
    }

    function _getDvns(bytes32 h) internal pure returns (address[] memory) {
        address[] memory dvns = new address[](2);
        // Second DVN is the same on all chains
        dvns[1] = 0xD56e4eAb23cb81f43168F9F45211Eb027b9aC7cc;
        // First DVN is chain-specific (sorted ascending)
        if (h == keccak256("optimism")) {
            dvns[0] = 0x6A02D83e8d433304bba74EF1c427913958187142;
        } else if (h == keccak256("base")) {
            dvns[0] = 0x9e059a54699a285714207b43B055483E78FAac25;
        } else {
            dvns[0] = 0x2f55C492897526677C5B68fb199ea31E2c126416; // arbitrum
        }
        return dvns;
    }
}
