import type { Address, Call } from 'viem';
import { erc20Abi, isAddressEqual } from 'viem';
import {
  BPS_BASE,
  createLogger,
  getPublicClient,
  getUSDCAddress,
  isUSDC,
  serializeBigInt,
  type QuoteFee,
  type QuoteToken,
  type TokenWithAmount,
  type QuoteDetailItem,
  type QuoteRequest,
  type QuoteResponse,
  type MultiInputQuoteRequest,
  type SwapRouteRequest,
  type SwapRouteResponse,
  type MultiInputQuoteResponse,
} from '@graviton/core';
import { config } from '../../config/index.js';
import { SwapQuoteFetcher, type SwapQuote } from '../swap/quote-fetcher.js';
import { CCTPQuoteFetcher } from '../cctp/quote-fetcher.js';
import { AcrossQuoteFetcher } from '../across/quote-fetcher.js';
// import type { Token } from '../../types/quote.types.js';

const logger = createLogger('quote-service', config.log.level);

// Cache for token metadata
const tokenMetadataCache = new Map<string, QuoteToken>();

export class QuoteService {
  private swapFetcher = new SwapQuoteFetcher();
  private cctpFetcher = new CCTPQuoteFetcher();
  private acrossFetcher = new AcrossQuoteFetcher();

  /**
   * Get a combined quote for swap + bridge + swap operations
   */
  async getQuote(params: QuoteRequest): Promise<QuoteResponse> {
    const {
      depositor,
      recipient,
      originChainId,
      destinationChainId,
      inputToken,
      outputToken,
      amount,
      swapType,
      slippage = 50, // Default 0.5%
      bridgeType = 'CCTP',
    } = params;

    logger.info(
      {
        depositor,
        recipient,
        originChainId,
        destinationChainId,
        inputToken,
        outputToken,
        amount,
        swapType,
        bridgeType,
      },
      'Getting combined quote'
    );

    // Validate bridge type
    if (bridgeType === 'RELAY') {
      throw new Error('RELAY bridge is not yet implemented');
    }

    // Get USDC addresses for the chains
    const originUSDC = getUSDCAddress(originChainId);
    const destUSDC = getUSDCAddress(destinationChainId);

    // Determine if swaps are needed
    const needsOriginSwap = !isUSDC(originChainId, inputToken);
    const needsDestSwap = !isUSDC(destinationChainId, outputToken);

    let swapOriginQuote: SwapQuote | undefined;
    let swapDestQuote: SwapQuote | undefined;
    const approvalCalls: Call[] = [];
    const swapCalls: Call[] = [];
    const feeDetails: QuoteFee[] = [];

    const amountBigInt = BigInt(amount);

    if (bridgeType === 'CCTP') {
      // CCTP only supports USDC, so we need to swap to/from USDC

      // 1. Origin swap (if needed)
      let bridgeAmount: bigint;
      if (needsOriginSwap) {
        if (swapType === 'EXACT_INPUT') {
          // Swap inputToken -> USDC with exact input
          swapOriginQuote = await this.swapFetcher.getSwapQuote(
            originChainId,
            inputToken,
            originUSDC,
            amountBigInt,
            'exactInput',
            depositor,
            slippage
          );
          bridgeAmount = swapOriginQuote.outputAmount;
        } else {
          // EXACT_OUTPUT: Need to work backwards
          // First get dest swap quote if needed, then bridge, then origin swap
          if (needsDestSwap) {
            // Get dest swap quote first (USDC -> outputToken, exact output)
            swapDestQuote = await this.swapFetcher.getSwapQuote(
              destinationChainId,
              destUSDC,
              outputToken,
              amountBigInt,
              'exactOutput',
              recipient,
              slippage
            );
            bridgeAmount = swapDestQuote.inputAmount;
          } else {
            bridgeAmount = amountBigInt;
          }

          // Get origin swap quote (inputToken -> USDC, exact output = bridgeAmount)
          swapOriginQuote = await this.swapFetcher.getSwapQuote(
            originChainId,
            inputToken,
            originUSDC,
            bridgeAmount,
            'exactOutput',
            depositor,
            slippage
          );
        }

        // Add approval and swap calls from origin swap
        approvalCalls.push(...swapOriginQuote.calls);
      } else {
        bridgeAmount = amountBigInt;
      }

      // 2. Get CCTP bridge quote
      const { fee: bridgeFee, calls: bridgeCalls } =
        await this.cctpFetcher.getBridgeQuote(
          originChainId,
          destinationChainId,
          originUSDC,
          bridgeAmount,
          recipient
        );

      swapCalls.push(...bridgeCalls);

      // 3. Destination swap (if needed and not already fetched)
      if (needsDestSwap && !swapDestQuote && swapType === 'EXACT_INPUT') {
        // For EXACT_INPUT, the dest swap input is the bridged amount
        swapDestQuote = await this.swapFetcher.getSwapQuote(
          destinationChainId,
          destUSDC,
          outputToken,
          bridgeAmount,
          'exactInput',
          recipient,
          slippage
        );
      }

      // Fetch token metadata
      const [inputTokenMeta, outputTokenMeta, originUSDCMeta, destUSDCMeta] =
        await Promise.all([
          this.getTokenMetadata(originChainId, inputToken),
          this.getTokenMetadata(destinationChainId, outputToken),
          this.getTokenMetadata(originChainId, originUSDC),
          this.getTokenMetadata(destinationChainId, destUSDC),
        ]);

      // Build fee details
      if (swapOriginQuote) {
        feeDetails.push({
          type: 'swap',
          amount: swapOriginQuote.gasEstimate,
          token: inputTokenMeta,
        });
      }

      feeDetails.push({
        type: 'bridge',
        amount: bridgeFee.bps,
        token: originUSDCMeta,
      });

      if (swapDestQuote) {
        feeDetails.push({
          type: 'swap',
          amount: swapDestQuote.gasEstimate,
          token: destUSDCMeta,
        });
      }

      // Calculate final amounts
      const finalInputAmount = swapOriginQuote
        ? swapOriginQuote.inputAmount
        : bridgeAmount;
      const finalOutputAmount = swapDestQuote
        ? swapDestQuote.outputAmount
        : bridgeAmount;

      // Build quote details
      const swapOriginDetail = swapOriginQuote
        ? this.buildQuoteDetail(
            'swap',
            inputTokenMeta,
            originUSDCMeta,
            swapOriginQuote,
            'Uniswap V4'
          )
        : undefined;

      const bridgeDetail: QuoteDetailItem = {
        type: 'bridge',
        inputToken: originUSDCMeta,
        outputToken: destUSDCMeta,
        inputAmount: bridgeAmount,
        outputAmount: bridgeAmount, // CCTP is 1:1 for USDC
        gasEstimate: bridgeFee.gas,
        protocol: 'Circle CCTP',
      };

      const swapDestinationDetail = swapDestQuote
        ? this.buildQuoteDetail(
            'swap',
            destUSDCMeta,
            outputTokenMeta,
            swapDestQuote,
            'Uniswap V4'
          )
        : undefined;

      return serializeBigInt({
        id: this.generateQuoteId(),
        amount:
          swapType === 'EXACT_INPUT' ? finalOutputAmount : finalInputAmount,
        approvalCalls,
        swapCalls,
        fees: {
          details: feeDetails,
        },
        details: {
          swapOrigin: swapOriginDetail,
          bridge: bridgeDetail,
          swapDestination: swapDestinationDetail,
        },
      });
    } else if (bridgeType === 'ACROSS') {
      // Across can handle multiple tokens, delegate to its API
      const bridgeFee = await this.acrossFetcher.getBridgeQuote(
        originChainId,
        destinationChainId,
        inputToken,
        outputToken,
        amountBigInt,
        depositor,
        recipient
      );

      // Fetch token metadata
      const [inputTokenMeta, outputTokenMeta] = await Promise.all([
        this.getTokenMetadata(originChainId, inputToken),
        this.getTokenMetadata(destinationChainId, outputToken),
      ]);

      feeDetails.push({
        type: 'bridge',
        amount: bridgeFee.bps,
        token: inputTokenMeta,
      });

      feeDetails.push({
        type: 'swap',
        amount: bridgeFee.gas,
        token: outputTokenMeta,
      });

      const bridgeDetail: QuoteDetailItem = {
        type: 'bridge',
        inputToken: inputTokenMeta,
        outputToken: outputTokenMeta,
        inputAmount: amountBigInt,
        outputAmount: amountBigInt, // Simplified - Across handles conversion
        gasEstimate: bridgeFee.gas,
        protocol: 'Across',
      };

      return {
        id: this.generateQuoteId(),
        amount: amountBigInt,
        approvalCalls: [],
        swapCalls,
        fees: {
          details: feeDetails,
        },
        details: {
          bridge: bridgeDetail,
        },
      };
    }

    throw new Error(`Unsupported bridge type: ${bridgeType}`);
  }

  /**
   * Get token metadata from chain
   */
  private async getTokenMetadata(
    chainId: number,
    tokenAddress: Address
  ): Promise<QuoteToken> {
    const cacheKey = `${chainId}:${tokenAddress.toLowerCase()}`;
    const cached = tokenMetadataCache.get(cacheKey);
    if (cached) return cached;

    const client = getPublicClient(chainId);

    try {
      const [name, symbol, decimals] = await Promise.all([
        client.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'name',
        }),
        client.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'symbol',
        }),
        client.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'decimals',
        }),
      ]);

      const token: QuoteToken = {
        address: tokenAddress,
        chainId,
        name,
        symbol,
        decimals,
      };

      tokenMetadataCache.set(cacheKey, token);
      return token;
    } catch (error) {
      logger.warn(
        { chainId, tokenAddress, error },
        'Failed to fetch token metadata, using defaults'
      );

      // Return default values if fetch fails
      const token: QuoteToken = {
        address: tokenAddress,
        chainId,
        name: 'Unknown',
        symbol: 'UNKNOWN',
        decimals: 18,
      };

      return token;
    }
  }

  /**
   * Build a quote detail object
   */
  private buildQuoteDetail(
    type: 'swap' | 'bridge',
    inputToken: QuoteToken,
    outputToken: QuoteToken,
    quote: SwapQuote,
    protocol: string
  ): QuoteDetailItem {
    return {
      type,
      inputToken,
      outputToken,
      inputAmount: quote.inputAmount,
      outputAmount: quote.outputAmount,
      gasEstimate: quote.gasEstimate,
      protocol,
    };
  }

  /**
   * Generate a unique quote ID
   */
  private generateQuoteId(): string {
    return `quote_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Get a multi-input quote for multiple input tokens to multiple outputs
   * Flow: multiple input swaps -> bridge -> multiple destination swaps
   */
  async getMultiInputQuote(
    params: MultiInputQuoteRequest
  ): Promise<MultiInputQuoteResponse> {
    const {
      depositor,
      recipient,
      originChainId,
      destinationChainId,
      inputTokens,
      outputTokens,
      slippage = 50,
      bridgeType,
    } = params;

    logger.info(
      {
        depositor,
        recipient,
        originChainId,
        destinationChainId,
        inputTokens,
        outputTokens,
        bridgeType,
      },
      'Getting multi-input quote'
    );

    if (bridgeType !== 'CCTP') {
      throw new Error('Multi-input quote only supports CCTP bridge currently');
    }

    // Get USDC addresses for the chains
    const originUSDC = getUSDCAddress(originChainId);
    const destUSDC = getUSDCAddress(destinationChainId);

    const quoteInputTokens: TokenWithAmount[] = [];
    const quoteOutputTokens: TokenWithAmount[] = [];
    const approvalCalls: Call[] = [];
    const swapCalls: Call[] = [];
    const targetCalls: Call[] = [];
    const feeDetails: QuoteFee[] = [];
    const swapOriginDetails: QuoteDetailItem[] = [];
    const swapDestinationDetails: QuoteDetailItem[] = [];

    // Same-chain: independent swap logic
    if (originChainId === destinationChainId) {
      return this.getSameChainMultiInputQuote({
        depositor,
        recipient,
        chainId: originChainId,
        inputTokens,
        outputTokens,
        slippage,
      });
    }

    // Cross-chain: Get destination swap quotes for each output token to determine bridge amount needed
    let bridgeAmount = 0n;
    const destSwapQuotes: { token: TokenWithAmount; quote?: SwapQuote }[] = [];

    for (const outputToken of outputTokens) {
      const outputAmountBigInt = BigInt(outputToken.amount);
      const needsDestSwap = !isUSDC(
        destinationChainId,
        outputToken.address as Address
      );

      if (needsDestSwap) {
        const swapDestQuote = await this.swapFetcher.getSwapQuote(
          destinationChainId,
          destUSDC,
          outputToken.address as Address,
          outputAmountBigInt,
          'exactOutput',
          recipient,
          slippage
        );
        bridgeAmount += swapDestQuote.inputAmount;
        destSwapQuotes.push({ token: outputToken, quote: swapDestQuote });
      } else {
        bridgeAmount += outputAmountBigInt;
        destSwapQuotes.push({ token: outputToken, quote: undefined });
      }
    }

    // 2. Get CCTP bridge quote and calculate inputAmount considering the fee
    const { fee: bridgeFee, calls: bridgeCalls } =
      await this.cctpFetcher.getBridgeQuote(
        originChainId,
        destinationChainId,
        originUSDC,
        bridgeAmount,
        recipient
      );
    swapCalls.push(...bridgeCalls);

    // Calculate the input amount from bps and bridge amount (ceiling division)
    const divisor = BPS_BASE - BigInt(bridgeFee.bps);
    const bridgeInputAmount =
      (bridgeAmount * BPS_BASE + divisor - 1n) / divisor;

    // 3. Get swap quotes for each input token to origin USDC
    // Distribute the bridge input amount (including fee) proportionally across input tokens
    let remainingBridgeAmount = bridgeInputAmount;
    const inputSwapQuotes: SwapQuote[] = [];

    for (let i = 0; i < inputTokens.length; i++) {
      const inputToken = inputTokens[i]!;
      const isLastToken = i === inputTokens.length - 1;

      // Check if input token is already USDC
      if (isUSDC(originChainId, inputToken.address as Address)) {
        const inputAmountBigInt = BigInt(inputToken.amount);

        // No swap needed, use the input amount directly (up to remaining bridge amount)
        let useAmount: bigint;
        if (isLastToken) {
          // Last token must cover remaining amount
          if (inputAmountBigInt < remainingBridgeAmount) {
            // throw new Error(
            //   `Insufficient USDC balance: ` +
            //     `required ${remainingBridgeAmount.toString()}, ` +
            //     `available ${inputToken.amount}`
            // );
            useAmount = inputAmountBigInt;
          } else {
            useAmount = remainingBridgeAmount;
          }
        } else {
          useAmount =
            inputAmountBigInt > remainingBridgeAmount
              ? remainingBridgeAmount
              : inputAmountBigInt;
        }

        // Add to quote tokens
        quoteInputTokens.push({
          address: inputToken.address,
          amount: useAmount,
        });

        remainingBridgeAmount -= useAmount;
      } else {
        // Get swap quote from input token to USDC
        // For last token, use exactOutput to get exactly what's needed
        // For others, use exactInput based on their available amount
        let swapQuote: SwapQuote;
        const inputAmountBigInt = BigInt(inputToken.amount);

        if (isLastToken && remainingBridgeAmount > 0n) {
          // Last token: exact output to get remaining amount needed
          swapQuote = await this.swapFetcher.getSwapQuote(
            originChainId,
            inputToken.address as Address,
            originUSDC,
            remainingBridgeAmount,
            'exactOutput',
            depositor,
            slippage
          );

          // Check if input token amount is sufficient
          if (swapQuote.inputAmount > inputAmountBigInt) {
            swapQuote = await this.swapFetcher.getSwapQuote(
              originChainId,
              inputToken.address as Address,
              originUSDC,
              inputAmountBigInt,
              'exactInput',
              depositor,
              slippage
            );
            // throw new Error(
            //   `Insufficient input token balance for ${inputToken.address}: ` +
            //     `required ${swapQuote.inputAmount.toString()}, ` +
            //     `available ${inputToken.amount}`
            // );
          }
        } else {
          // Other tokens: exact input using their full amount
          swapQuote = await this.swapFetcher.getSwapQuote(
            originChainId,
            inputToken.address as Address,
            originUSDC,
            inputAmountBigInt,
            'exactInput',
            depositor,
            slippage
          );

          // If exactInput swap output exceeds remaining amount needed,
          // use exactOutput to swap only what's needed
          // TODO: Optimize by calculating the exact input amount locally from the quote
          // instead of making another RPC call
          if (swapQuote.outputAmount > remainingBridgeAmount) {
            swapQuote = await this.swapFetcher.getSwapQuote(
              originChainId,
              inputToken.address as Address,
              originUSDC,
              remainingBridgeAmount,
              'exactOutput',
              depositor,
              slippage
            );

            // Verify the exactOutput quote doesn't require more than available
            if (swapQuote.inputAmount > inputAmountBigInt) {
              // throw new Error(
              //   `Insufficient input token balance for ${inputToken.address}: ` +
              //   `required ${swapQuote.inputAmount.toString()}, ` +
              //   `available ${inputToken.amount}`
              // );

              swapQuote = await this.swapFetcher.getSwapQuote(
                originChainId,
                inputToken.address as Address,
                originUSDC,
                inputAmountBigInt,
                'exactInput',
                depositor,
                slippage
              );
            }
          }
        }

        inputSwapQuotes.push(swapQuote);
        approvalCalls.push(...swapQuote.calls);
        remainingBridgeAmount -= swapQuote.outputAmount;

        // Add to quote tokens
        quoteInputTokens.push({
          address: inputToken.address,
          amount: swapQuote.inputAmount,
        });

        // Build swap origin detail
        const inputTokenMeta = await this.getTokenMetadata(
          originChainId,
          inputToken.address as Address
        );
        const originUSDCMeta = await this.getTokenMetadata(
          originChainId,
          originUSDC
        );

        swapOriginDetails.push(
          this.buildQuoteDetail(
            'swap',
            inputTokenMeta,
            originUSDCMeta,
            swapQuote,
            'Uniswap V4'
          )
        );

        feeDetails.push({
          type: 'swap',
          amount: swapQuote.gasEstimate,
          token: inputTokenMeta,
        });
      }

      if (remainingBridgeAmount <= 0n) break;
    }

    // Fetch token metadata for response
    const [originUSDCMeta, destUSDCMeta] = await Promise.all([
      this.getTokenMetadata(originChainId, originUSDC),
      this.getTokenMetadata(destinationChainId, destUSDC),
    ]);

    // Add bridge fee
    feeDetails.push({
      type: 'bridge',
      amount: bridgeFee.bps,
      token: originUSDCMeta,
    });

    // Build bridge detail with actual amounts (adjusted for input shortfall)
    const actualBridgeInputAmount = bridgeInputAmount - remainingBridgeAmount;
    const actualBridgeOutputAmount =
      remainingBridgeAmount > 0n
        ? (bridgeAmount * actualBridgeInputAmount) / bridgeInputAmount
        : bridgeAmount;

    const bridgeDetail: QuoteDetailItem = {
      type: 'bridge',
      inputToken: originUSDCMeta,
      outputToken: destUSDCMeta,
      inputAmount: actualBridgeInputAmount,
      outputAmount: actualBridgeOutputAmount,
      // TODO: return bps and relayer fee
      gasEstimate:
        bridgeFee.gas +
        (bridgeFee.bps * actualBridgeInputAmount + BPS_BASE - 1n) / BPS_BASE,
      protocol: 'Circle CCTP',
    };

    // Build destination swap details for each output token
    const hasShortfall = remainingBridgeAmount > 0n;

    for (const { token: outputToken, quote: swapDestQuote } of destSwapQuotes) {
      const outputAmountBigInt = BigInt(outputToken.amount);

      if (swapDestQuote) {
        // If inputs were insufficient, re-fetch with exactInput using proportional USDC
        const finalDestQuote = hasShortfall
          ? await this.swapFetcher.getSwapQuote(
              destinationChainId,
              destUSDC,
              outputToken.address as Address,
              (swapDestQuote.inputAmount * actualBridgeOutputAmount) /
                bridgeAmount,
              'exactInput',
              recipient,
              slippage
            )
          : swapDestQuote;

        targetCalls.push(...finalDestQuote.calls);
        const outputTokenMeta = await this.getTokenMetadata(
          destinationChainId,
          outputToken.address as Address
        );

        swapDestinationDetails.push(
          this.buildQuoteDetail(
            'swap',
            destUSDCMeta,
            outputTokenMeta,
            finalDestQuote,
            'Uniswap V4'
          )
        );

        feeDetails.push({
          type: 'swap',
          amount: finalDestQuote.gasEstimate,
          token: destUSDCMeta,
        });

        quoteOutputTokens.push({
          address: outputToken.address,
          amount: finalDestQuote.outputAmount,
        });
      } else {
        // Output is USDC, no swap needed
        const actualOutput = hasShortfall
          ? (outputAmountBigInt * actualBridgeOutputAmount) / bridgeAmount
          : outputAmountBigInt;

        quoteOutputTokens.push({
          address: outputToken.address,
          amount: actualOutput,
        });
      }
    }

    return {
      id: this.generateQuoteId(),
      inputTokens: quoteInputTokens,
      outputTokens: quoteOutputTokens,
      approvalCalls,
      swapCalls,
      targetCalls,
      fees: {
        details: feeDetails,
      },
      details: {
        swapOrigin: swapOriginDetails,
        bridge: bridgeDetail,
        swapDestination: swapDestinationDetails,
      },
    };
  }

  /**
   * Same-chain multi-input quote:
   * 1. Match same-address input/output tokens directly (no swap)
   * 2. Swap remaining inputs -> remaining outputs directly
   */
  private async getSameChainMultiInputQuote(params: {
    depositor: Address;
    recipient: Address;
    chainId: number;
    inputTokens: TokenWithAmount[];
    outputTokens: TokenWithAmount[];
    slippage: number;
  }): Promise<MultiInputQuoteResponse> {
    const { depositor, chainId, inputTokens, outputTokens, slippage } = params;
    const usdcAddress = getUSDCAddress(chainId);
    const usdcMeta = await this.getTokenMetadata(chainId, usdcAddress);

    const targetCalls: Call[] = [];
    const feeDetails: QuoteFee[] = [];
    const swapDetails: QuoteDetailItem[] = [];
    const quoteInputTokens: TokenWithAmount[] = [];
    const quoteOutputTokens: TokenWithAmount[] = [];

    const inputRemaining = inputTokens.map((t) => BigInt(t.amount));
    const outputRemaining = outputTokens.map((t) => BigInt(t.amount));

    // Fill outputs from inputs via direct swaps
    for (let o = 0; o < outputTokens.length; o++) {
      if (outputRemaining[o]! <= 0n) continue;

      for (let i = 0; i < inputTokens.length; i++) {
        if (outputRemaining[o]! <= 0n) break;
        if (inputRemaining[i]! <= 0n) continue;

        const input = inputTokens[i]!;
        const output = outputTokens[o]!;
        const available = inputRemaining[i]!;
        const needed = outputRemaining[o]!;

        // Same token: subtract directly, no swap needed
        if (isAddressEqual(input.address, output.address)) {
          const matched = available >= needed ? needed : available;
          inputRemaining[i]! -= matched;
          outputRemaining[o]! -= matched;
          continue;
        }

        // Try exactInput with all available input
        let quote = await this.swapFetcher.getSwapQuote(
          chainId,
          input.address as Address,
          output.address as Address,
          available,
          'exactInput',
          depositor,
          slippage
        );

        // If output exceeds what's needed, use exactOutput to swap only what's needed
        if (quote.outputAmount >= needed) {
          const exactOutputQuote = await this.swapFetcher.getSwapQuote(
            chainId,
            input.address as Address,
            output.address as Address,
            needed,
            'exactOutput',
            depositor,
            slippage
          );
          if (exactOutputQuote.inputAmount <= available) {
            quote = exactOutputQuote;
          }
        }

        targetCalls.push(...quote.calls);
        inputRemaining[i]! -= quote.inputAmount;
        outputRemaining[o]! -= quote.outputAmount;

        const [inputTokenMeta, outputTokenMeta] = await Promise.all([
          this.getTokenMetadata(chainId, input.address as Address),
          this.getTokenMetadata(chainId, output.address as Address),
        ]);
        swapDetails.push(
          this.buildQuoteDetail(
            'swap',
            inputTokenMeta,
            outputTokenMeta,
            quote,
            'Uniswap V4'
          )
        );
        feeDetails.push({
          type: 'swap',
          amount: quote.gasEstimate,
          token: inputTokenMeta,
        });
      }
    }

    // Build quoteInputTokens (total used = original - remaining)
    for (let i = 0; i < inputTokens.length; i++) {
      const used = BigInt(inputTokens[i]!.amount) - inputRemaining[i]!;
      if (used > 0n) {
        quoteInputTokens.push({
          address: inputTokens[i]!.address,
          amount: used,
        });
      }
    }

    // Build quoteOutputTokens (total filled = original - remaining unfilled)
    for (let o = 0; o < outputTokens.length; o++) {
      const filled = BigInt(outputTokens[o]!.amount) - outputRemaining[o]!;
      quoteOutputTokens.push({
        address: outputTokens[o]!.address,
        amount: filled,
      });
    }

    return {
      id: this.generateQuoteId(),
      inputTokens: quoteInputTokens,
      outputTokens: quoteOutputTokens,
      approvalCalls: [],
      swapCalls: [],
      targetCalls,
      fees: { details: feeDetails },
      details: {
        swapOrigin: [],
        bridge: {
          inputAmount: 0n,
          outputAmount: 0n,
          gasEstimate: 0n,
          protocol: 'none',
          inputToken: usdcMeta,
          outputToken: usdcMeta,
          type: 'bridge',
        },
        swapDestination: swapDetails,
      },
    };
  }

  /**
   * Get swap route quotes for multiple input tokens to multiple output tokens
   * Returns a quote for each input token -> all output tokens combination
   */
  async getSwapRoute(params: SwapRouteRequest): Promise<SwapRouteResponse> {
    const {
      inputTokens,
      originChainId,
      outputTokens,
      destinationChainId,
      bridgeType,
      depositor,
      recipient,
      slippage = 50,
    } = params;

    logger.info(
      {
        inputTokens,
        originChainId,
        outputTokens,
        destinationChainId,
        bridgeType,
      },
      'Getting swap route quotes'
    );

    if (bridgeType === 'RELAY') {
      throw new Error('RELAY bridge is not yet implemented');
    }

    const isSameChain = originChainId === destinationChainId;
    const routes: QuoteResponse[] = [];

    // Get USDC addresses for the chains
    const originUSDC = getUSDCAddress(originChainId);
    const destUSDC = getUSDCAddress(destinationChainId);

    // Fetch destination swap quotes once (they're the same for all input tokens)
    const destSwapQuotes: { token: TokenWithAmount; quote?: SwapQuote }[] = [];
    let totalBridgeAmount = 0n;

    for (const outputToken of outputTokens) {
      const outputAmountBigInt = BigInt(outputToken.amount);
      const needsDestSwap = !isUSDC(
        destinationChainId,
        outputToken.address as Address
      );

      if (needsDestSwap) {
        const swapDestQuote = await this.swapFetcher.getSwapQuote(
          destinationChainId,
          destUSDC,
          outputToken.address as Address,
          outputAmountBigInt,
          'exactOutput',
          recipient ?? (depositor as Address),
          slippage
        );
        totalBridgeAmount += swapDestQuote.inputAmount;
        destSwapQuotes.push({ token: outputToken, quote: swapDestQuote });
      } else {
        totalBridgeAmount += outputAmountBigInt;
        destSwapQuotes.push({ token: outputToken, quote: undefined });
      }
    }

    // Process each input token in parallel
    const routePromises = inputTokens.map(async (inputToken) => {
      const feeDetails: QuoteFee[] = [];
      const srcCalls: Call[] = [];
      const swapCalls: Call[] = [];
      const targetCalls: Call[] = [];
      const swapDestinationDetails: QuoteDetailItem[] = [];

      const needsOriginSwap = !isUSDC(originChainId, inputToken);

      let bridgeInputAmount: bigint;
      let swapOriginQuote: SwapQuote | undefined;
      let swapOriginDetail: QuoteDetailItem | undefined;

      if (isSameChain) {
        // Same-chain: no bridge or origin swap needed
        bridgeInputAmount = totalBridgeAmount;

        const destUSDCMeta = await this.getTokenMetadata(
          destinationChainId,
          destUSDC
        );

        for (const {
          token: outputToken,
          quote: swapDestQuote,
        } of destSwapQuotes) {
          if (swapDestQuote) {
            targetCalls.push(...swapDestQuote.calls);
            const outputTokenMeta = await this.getTokenMetadata(
              destinationChainId,
              outputToken.address as Address
            );

            swapDestinationDetails.push(
              this.buildQuoteDetail(
                'swap',
                destUSDCMeta,
                outputTokenMeta,
                swapDestQuote,
                'Uniswap V4'
              )
            );

            feeDetails.push({
              type: 'swap',
              amount: swapDestQuote.gasEstimate,
              token: destUSDCMeta,
            });
          }
        }

        return serializeBigInt({
          inputToken,
          inputAmount: bridgeInputAmount,
          srcCalls,
          swapCalls,
          targetCalls,
          fees: { details: feeDetails },
          details: {
            swapOrigin: undefined,
            bridge: undefined,
            swapDestination: swapDestinationDetails,
          },
        });
      } else if (bridgeType === 'CCTP') {
        // Get CCTP bridge quote to calculate required input amount
        const { fee: bridgeFee, calls: bridgeCalls } =
          await this.cctpFetcher.getBridgeQuote(
            originChainId,
            destinationChainId,
            originUSDC,
            totalBridgeAmount,
            recipient ?? depositor
          );
        swapCalls.push(...bridgeCalls);

        // Calculate the input amount considering bps fee (ceiling division)
        const divisor = BPS_BASE - BigInt(bridgeFee.bps);
        bridgeInputAmount =
          (totalBridgeAmount * BPS_BASE + divisor - 1n) / divisor;

        // Origin swap if needed
        if (needsOriginSwap) {
          swapOriginQuote = await this.swapFetcher.getSwapQuote(
            originChainId,
            inputToken,
            originUSDC,
            bridgeInputAmount,
            'exactOutput',
            depositor as Address,
            slippage
          );
          srcCalls.push(...swapOriginQuote.calls);

          const inputTokenMeta = await this.getTokenMetadata(
            originChainId,
            inputToken
          );
          const originUSDCMeta = await this.getTokenMetadata(
            originChainId,
            originUSDC
          );

          swapOriginDetail = this.buildQuoteDetail(
            'swap',
            inputTokenMeta,
            originUSDCMeta,
            swapOriginQuote,
            'Uniswap V4'
          );

          feeDetails.push({
            type: 'swap',
            amount: swapOriginQuote.gasEstimate,
            token: inputTokenMeta,
          });
        }

        // Add bridge fee
        const originUSDCMeta = await this.getTokenMetadata(
          originChainId,
          originUSDC
        );
        const destUSDCMeta = await this.getTokenMetadata(
          destinationChainId,
          destUSDC
        );

        feeDetails.push({
          type: 'bridge',
          amount: bridgeFee.bps,
          token: originUSDCMeta,
        });

        // Build bridge detail
        const bridgeDetail: QuoteDetailItem = {
          type: 'bridge',
          inputToken: originUSDCMeta,
          outputToken: destUSDCMeta,
          inputAmount: bridgeInputAmount,
          outputAmount: totalBridgeAmount,
          // TODO: return bps and relayer fee
          gasEstimate:
            bridgeFee.gas +
            (bridgeFee.bps * bridgeInputAmount + BPS_BASE - 1n) / BPS_BASE,
          protocol: 'Circle CCTP',
        };

        // Add destination swap calls and details
        for (const {
          token: outputToken,
          quote: swapDestQuote,
        } of destSwapQuotes) {
          if (swapDestQuote) {
            targetCalls.push(...swapDestQuote.calls);
            const outputTokenMeta = await this.getTokenMetadata(
              destinationChainId,
              outputToken.address as Address
            );

            swapDestinationDetails.push(
              this.buildQuoteDetail(
                'swap',
                destUSDCMeta,
                outputTokenMeta,
                swapDestQuote,
                'Uniswap V4'
              )
            );

            feeDetails.push({
              type: 'swap',
              amount: swapDestQuote.gasEstimate,
              token: destUSDCMeta,
            });
          }
        }

        const finalInputAmount = swapOriginQuote
          ? swapOriginQuote.inputAmount
          : bridgeInputAmount;

        return serializeBigInt({
          inputToken,
          inputAmount: finalInputAmount,
          srcCalls,
          swapCalls,
          targetCalls,
          fees: { details: feeDetails },
          details: {
            swapOrigin: swapOriginDetail,
            bridge: bridgeDetail,
            swapDestination: swapDestinationDetails,
          },
        });
      } else if (bridgeType === 'ACROSS') {
        // Across handles token conversion, so bridge directly
        const bridgeFee = await this.acrossFetcher.getBridgeQuote(
          originChainId,
          destinationChainId,
          inputToken,
          destUSDC, // Across bridges to USDC on destination
          totalBridgeAmount,
          depositor as Address,
          recipient ?? (depositor as Address)
        );

        const [inputTokenMeta, destUSDCMeta] = await Promise.all([
          this.getTokenMetadata(originChainId, inputToken),
          this.getTokenMetadata(destinationChainId, destUSDC),
        ]);

        feeDetails.push({
          type: 'bridge',
          amount: bridgeFee.bps,
          token: inputTokenMeta,
        });

        feeDetails.push({
          type: 'swap',
          amount: bridgeFee.gas,
          token: destUSDCMeta,
        });

        const bridgeDetail: QuoteDetailItem = {
          type: 'bridge',
          inputToken: inputTokenMeta,
          outputToken: destUSDCMeta,
          inputAmount: totalBridgeAmount,
          outputAmount: totalBridgeAmount,
          gasEstimate: bridgeFee.gas,
          protocol: 'Across',
        };

        // Add destination swap calls and details
        for (const {
          token: outputToken,
          quote: swapDestQuote,
        } of destSwapQuotes) {
          if (swapDestQuote) {
            targetCalls.push(...swapDestQuote.calls);
            const outputTokenMeta = await this.getTokenMetadata(
              destinationChainId,
              outputToken.address as Address
            );

            swapDestinationDetails.push(
              this.buildQuoteDetail(
                'swap',
                destUSDCMeta,
                outputTokenMeta,
                swapDestQuote,
                'Uniswap V4'
              )
            );

            feeDetails.push({
              type: 'swap',
              amount: swapDestQuote.gasEstimate,
              token: destUSDCMeta,
            });
          }
        }

        return serializeBigInt({
          inputToken,
          inputAmount: totalBridgeAmount,
          srcCalls,
          swapCalls,
          targetCalls,
          fees: { details: feeDetails },
          details: {
            swapOrigin: undefined,
            bridge: bridgeDetail,
            swapDestination: swapDestinationDetails,
          },
        });
      }

      throw new Error(`Unsupported bridge type: ${bridgeType}`);
    });

    const resolvedRoutes = await Promise.all(routePromises);
    routes.push(...resolvedRoutes);

    return serializeBigInt({
      id: this.generateQuoteId(),
      routes,
    });
  }
}
