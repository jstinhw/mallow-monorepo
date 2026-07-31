// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC7579Module} from "./interfaces/IERC7579Module.sol";
import {IERC7579Account} from "./interfaces/IERC7579Account.sol";
import {IInteropExecutor} from "./interfaces/IInteropExecutor.sol";
import {Order, SrcIntent, Call, PaymentToken, ValidationCall, ExecutionCall} from "./types/Structs.sol";
import {SENDER_CREATOR, NATIVE_TOKEN} from "./types/Constants.sol";
import {NonceManager, Nonce} from "./utils/NonceManager.sol";
import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";
import {ECDSA} from "solady/utils/ECDSA.sol";
import {ERC20} from "solady/tokens/ERC20.sol";
import {IPostHook} from "./interfaces/IHooks.sol";
import {IInteropValidator} from "./interfaces/IInteropValidator.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";

contract InteropExecutor is IERC7579Module, IInteropExecutor {
    //mapping(address => uint256) public _paymentNonce;
    Nonce internal _paymentNonce;
    //mapping(address => uint256) public _executionNonce;
    Nonce internal _executionNonce;

    constructor() {}

    receive() external payable {}

    /// @inheritdoc IERC7579Module
    function onInstall(bytes calldata) external {}

    /// @inheritdoc IERC7579Module
    function onUninstall(bytes calldata) external {}

    /// @inheritdoc IERC7579Module
    function isModuleType(uint256 moduleTypeId) external pure returns (bool) {
        return moduleTypeId == 2;
    }

    /// @inheritdoc IInteropExecutor
    function open(Order calldata order) external payable {
        // step 1, verify deadline
        require(order.openDeadline >= block.timestamp || order.openDeadline == 0, OrderExpired());

        // step 2, check src intents chainId/nonce
        SrcIntent memory srcIntent = order.srcIntent;
        require(srcIntent.chainId == block.chainid, InvalidSrcIntent());

        uint160 key = NonceManager.getKey(srcIntent.nonce);
        require(srcIntent.nonce == NonceManager.increment(_paymentNonce, order.sender, key), InvalidNonce());

        // step 3, create sender if not exists
        _createSender(order.sender, order.initData);

        // step 4, compute order hash
        bytes32 orderHash = _getHash(order);

        // step 5, run prehook
        bytes[] memory preHookContexts = new bytes[](srcIntent.preHooks.length);
        for (uint256 i = 0; i < srcIntent.preHooks.length; i++) {
            Call memory preHook = srcIntent.preHooks[i];
            try IERC7579Account(order.sender)
                .executeFromExecutor(bytes32(0), abi.encodePacked(preHook.to, preHook.value, preHook.data)) returns (
                bytes[] memory results
            ) {
                preHookContexts[i] = abi.encode(results);
            } catch {
                revert PreHookFailed();
            }
        }

        // step 6, verify signature
        bool signed = _verifySignature(order.sender, orderHash, order.signature);

        // step 7, transfer payment tokens
        for (uint256 i = 0; i < srcIntent.paymentTokens.length; i++) {
            _transferPaymentToken(order.sender, srcIntent.paymentTokens[i]);
        }

        // step 8, run bridge
        if (srcIntent.chainId != order.targetIntent.chainId) {
            _bridge(order);
        }

        // step 9, run posthook
        for (uint256 i = 0; i < srcIntent.postHooks.length; i++) {
            Call memory postHook = srcIntent.postHooks[i];
            try IPostHook(postHook.to).execute{value: postHook.value}(postHook.data, preHookContexts[i]) {}
            catch {
                revert PostHookFailed();
            }
        }

        // step 10, run targetIntent if same chain
        if (order.targetIntent.chainId == block.chainid) {
            _innerExecute(order, orderHash);
        }

        // step 11, emit order opened
        emit OrderOpened(orderHash, order.sender, order.targetIntent.chainId);

        // step 12, revert if signature fails (gas simulation)
        require(signed, InvalidSignature());
    }

    /// @inheritdoc IInteropExecutor
    function fill(Order calldata order, address, uint256 amount) external payable {
        // step 1, transfer token from msg.sender to order.sender
        if (order.targetIntent.token == NATIVE_TOKEN) {
            (bool success,) = order.sender.call{value: amount}("");
            require(success, FillFailed());
        } else {
            SafeTransferLib.safeTransferFrom(order.targetIntent.token, msg.sender, order.sender, amount);
        }
        bytes32 orderHash = _getHash(order);

        // step 2, create sender if not exists
        _createSender(order.sender, order.initData);

        // step 3, verify signature
        bool signed = _verifySignature(order.sender, orderHash, order.signature);

        // step 4. execute order
        _innerExecute(order, orderHash);

        // step 5, revert if signature fails (gas simulation)
        require(signed, InvalidSignature());
    }

    function getHash(Order calldata order) external pure returns (bytes32) {
        return _getHash(order);
    }

    function paymentNonce(address _sender, uint160 _key) external view returns (uint256) {
        return NonceManager.getNonce(_paymentNonce, _sender, _key);
    }

    function executionNonce(address _sender, uint160 _key) external view returns (uint256) {
        return NonceManager.getNonce(_executionNonce, _sender, _key);
    }

    function paymentNonce(address _sender) external view returns (uint256) {
        return NonceManager.getNonce(_paymentNonce, _sender);
    }

    function executionNonce(address _sender) external view returns (uint256) {
        return NonceManager.getNonce(_executionNonce, _sender);
    }

    // TODO: ERC-7964
    function _getHash(Order calldata order) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                order.sender,
                order.openDeadline,
                order.fillDeadline,
                order.initData,
                order.targetIntent,
                order.srcIntent
            )
        );
    }

    function _createSender(address sender, bytes memory initData) internal {
        if (sender.code.length == 0) {
            address created = SENDER_CREATOR.createSender(initData);
            require(created == sender && sender.code.length > 0, InvalidSender(sender, created));
        }
    }

    function _verifySignature(address sender, bytes32 intentHash, bytes memory signature) internal view returns (bool) {
        return SignatureCheckerLib.isValidSignatureNow(sender, ECDSA.toEthSignedMessageHash(intentHash), signature);
    }

    function _transferPaymentToken(address _account, PaymentToken memory _paymentToken) internal {
        if (_paymentToken.token == NATIVE_TOKEN) {
            IERC7579Account(_account)
                .executeFromExecutor(bytes32(0), abi.encodePacked(_paymentToken.recipient, _paymentToken.amount, hex""));
        } else {
            IERC7579Account(_account)
                .executeFromExecutor(
                    bytes32(0),
                    abi.encodePacked(
                        _paymentToken.token,
                        uint256(0),
                        abi.encodeWithSelector(ERC20.transfer.selector, _paymentToken.recipient, _paymentToken.amount)
                    )
                );
        }
    }

    function _bridge(Order calldata order) internal {
        if (order.srcIntent.token == address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE)) {
            // transfer native from account to InteropExecutor
            IERC7579Account(order.sender)
                .executeFromExecutor(bytes32(0), abi.encodePacked(address(this), order.srcIntent.amount, hex""));

            // call adapter and transfer native from InteropExecutor to adapter
            order.srcIntent.adapter.initiateBridge{value: order.srcIntent.amount}(
                order.srcIntent.token, order.srcIntent.amount, order.srcIntent.adapterData, order
            );
        } else {
            // transfer token from account to InteropExecutor
            IERC7579Account(order.sender)
                .executeFromExecutor(
                    bytes32(0),
                    abi.encodePacked(
                        order.srcIntent.token,
                        uint256(0),
                        abi.encodeWithSelector(ERC20.transfer.selector, address(this), order.srcIntent.amount)
                    )
                );

            // approve adapter
            SafeTransferLib.safeApprove(order.srcIntent.token, address(order.srcIntent.adapter), order.srcIntent.amount);

            // call adapter
            order.srcIntent.adapter
                .initiateBridge(order.srcIntent.token, order.srcIntent.amount, order.srcIntent.adapterData, order);
        }
    }

    function _innerExecute(Order calldata _order, bytes32 _orderHash) internal {
        // step 1, verify nonce
        uint160 nonceKey = NonceManager.getKey(_order.targetIntent.nonce);
        require(
            NonceManager.getNonce(_executionNonce, _order.sender, nonceKey) == _order.targetIntent.nonce, InvalidNonce()
        );

        // step 2. run validationHooks
        bool fulfilled = true;
        for (uint256 i = 0; i < _order.targetIntent.validations.length; i++) {
            ValidationCall calldata validation = _order.targetIntent.validations[i];
            try IInteropValidator(validation.validator).validate(_order, validation.data) returns (bool isValid) {
                fulfilled = fulfilled && isValid;
            } catch {
                fulfilled = false;
            }
        }

        if (fulfilled) {
            // step 3. increment nonce and run executions
            NonceManager.increment(_executionNonce, _order.sender, nonceKey);

            for (uint256 i = 0; i < _order.targetIntent.executions.length; i++) {
                ExecutionCall calldata execution = _order.targetIntent.executions[i];

                IERC7579Account(_order.sender).executeFromExecutor(execution.mode, execution.data);
            }
        }

        // step 4, emit order filled
        emit OrderFilled(_orderHash, _order.sender, _order.srcIntent.chainId);
    }
}
