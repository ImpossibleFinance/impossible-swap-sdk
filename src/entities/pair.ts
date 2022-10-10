import { BigintIsh, CurrencyAmount, Price, SupportedChainId, Token } from '@uniswap/sdk-core'

import invariant from 'tiny-invariant'
import JSBI from 'jsbi'
import { pack, keccak256 } from '@ethersproject/solidity'
import { getCreate2Address } from '@ethersproject/address'

import {
  FACTORY_ADDRESS,
  INIT_CODE_HASH,
  MINIMUM_LIQUIDITY,
  ZERO,
  ONE,
  TWO,
  FIVE,
  EIGHT,
  _10000,
  TradeState
} from '../constants'
import { sqrt, parseBigintIsh } from '../utils'
import { InsufficientReservesError, InsufficientInputAmountError, TradeNotSupportedError } from '../errors'

let PAIR_ADDRESS_CACHE: { [token0Address: string]: { [token1Address: string]: string } } = {}

export class Pair {
  public readonly liquidityToken: Token
  public readonly isXybk: Boolean
  public readonly fee: number
  public readonly boost0: number
  public readonly boost1: number
  public readonly sqrtK: JSBI
  public readonly tradeState: TradeState

  private readonly tokenAmounts: [CurrencyAmount<Token>, CurrencyAmount<Token>]

  public static getAddress(tokenA: Token, tokenB: Token): string {
    const tokens = tokenA.sortsBefore(tokenB) ? [tokenA, tokenB] : [tokenB, tokenA] // does safety checks

    if (PAIR_ADDRESS_CACHE?.[tokens[0].address]?.[tokens[1].address] === undefined) {
      PAIR_ADDRESS_CACHE = {
        ...PAIR_ADDRESS_CACHE,
        [tokens[0].address]: {
          ...PAIR_ADDRESS_CACHE?.[tokens[0].address],
          [tokens[1].address]: getCreate2Address(
            FACTORY_ADDRESS,
            keccak256(['bytes'], [pack(['address', 'address'], [tokens[0].address, tokens[1].address])]),
            INIT_CODE_HASH
          )
        }
      }
    }

    return PAIR_ADDRESS_CACHE[tokens[0].address][tokens[1].address]
  }

  public constructor(
    tokenAmountA: CurrencyAmount<Token>,
    tokenAmountB: CurrencyAmount<Token>,
    isXybk: Boolean,
    fee: number,
    boost0: number,
    boost1: number,
    tradeState: TradeState
  ) {
    invariant(boost0 >= 1 && boost1 >= 1, 'INVALID_BOOST')
    invariant(fee >= 0 && fee <= 10000, 'INVALID_FEE')

    const tokenAmounts = tokenAmountA.currency.sortsBefore(tokenAmountB.currency) // does safety checks
      ? [tokenAmountA, tokenAmountB]
      : [tokenAmountB, tokenAmountA]
    this.liquidityToken = new Token(
      tokenAmounts[0].currency.chainId,
      Pair.getAddress(tokenAmounts[0].currency, tokenAmounts[1].currency),
      18,
      'IF-LP',
      `Impossible Swap LPs: ${tokenAmounts[0].currency.symbol}/${tokenAmounts[1].currency.symbol}`
    )
    this.tokenAmounts = tokenAmounts as [CurrencyAmount<Token>, CurrencyAmount<Token>]
    this.isXybk = isXybk
    this.fee = fee
    this.boost0 = boost0
    this.boost1 = boost1
    this.sqrtK = this.computeXybkSqrtK(boost0, boost1)
    this.tradeState = tradeState
  }

  /**
   * Calculates xybk SqrtK from reserve0, reserve1
   */
  private computeXybkSqrtK(b0: number, b1: number): JSBI {
    let boost: JSBI = JSBI.BigInt(
      JSBI.greaterThan(this.tokenAmounts[0].numerator, this.tokenAmounts[1].numerator) ? b0 - 1 : b1 - 1
    )

    let denom: JSBI = JSBI.add(JSBI.multiply(boost, TWO), ONE)

    let term: JSBI = JSBI.divide(
      JSBI.multiply(boost, JSBI.add(this.tokenAmounts[0].numerator, this.tokenAmounts[1].numerator)),
      JSBI.multiply(denom, TWO)
    )

    let result: JSBI = JSBI.add(
      JSBI.exponentiate(term, TWO),
      JSBI.divide(JSBI.multiply(this.tokenAmounts[0].numerator, this.tokenAmounts[1].numerator), denom)
    )

    return JSBI.add(this.sqrt(result), term)
  }

  /**
   * Returns artificial liquidity term [(boost-1)*SqrtK] to be added to real reserves for xybk invariant
   */

  // TODO: probably can make private
  public artiLiquidityTerm(boost: number): JSBI {
    return JSBI.multiply(JSBI.BigInt(boost - 1), this.sqrtK)
  }

  public getBoost(): number {
    return JSBI.greaterThan(this.tokenAmounts[0].numerator, this.tokenAmounts[1].numerator) ? this.boost0 : this.boost1
  }

  /*
   * Source: https://gist.github.com/JochemKuijpers/cd1ad9ec23d6d90959c549de5892d6cb
   * Can also try: https://github.com/peterolson/BigInteger.js/issues/146
   * If speed too slow, implement Brent's method for finding sqrts
   */
  public sqrt(n: JSBI): JSBI {
    let a: JSBI = ONE
    let b: JSBI = JSBI.add(JSBI.signedRightShift(n, FIVE), EIGHT)
    while (JSBI.greaterThanOrEqual(b, a)) {
      const mid: JSBI = JSBI.signedRightShift(JSBI.add(b, a), ONE)
      if (JSBI.greaterThan(JSBI.exponentiate(mid, TWO), n)) {
        b = JSBI.subtract(mid, ONE)
      } else {
        a = JSBI.add(mid, ONE)
      }
    }
    return JSBI.subtract(a, ONE)
  }

  /**
   * Returns true if the token is either token0 or token1
   * @param token to check
   */
  public involvesToken(token: Token): boolean {
    return token.equals(this.token0) || token.equals(this.token1)
  }

  /**
   * Returns the instantaneous  price of token 0 in token 1 (could be xybk)
   */
  public get token0Price(): Price<Token, Token> {
    if (this.isXybk) {
      let term: JSBI = this.artiLiquidityTerm(this.getBoost())
      return new Price(
        this.token0,
        this.token1,
        JSBI.add(this.tokenAmounts[0].numerator, term),
        JSBI.add(this.tokenAmounts[1].numerator, term)
      )
    } else {
      return this.token0LpPrice
    }
  }

  /**
   * Returns the uni prices of token 0 in token 1
   */
  public get token0LpPrice(): Price<Token, Token> {
    return new Price(this.token0, this.token1, this.tokenAmounts[0].numerator, this.tokenAmounts[1].numerator)
  }

  /**
   * Returns the instantaneous price of token 1 in token 0 (could be xybk)
   */
  public get token1Price(): Price<Token, Token> {
    if (this.isXybk) {
      let term: JSBI = this.artiLiquidityTerm(this.getBoost())
      return new Price(
        this.token1,
        this.token0,
        JSBI.add(this.tokenAmounts[1].numerator, term),
        JSBI.add(this.tokenAmounts[0].numerator, term)
      )
    } else {
      return this.token1LpPrice
    }
  }

  /**
   * Returns the uni prices of token 1 in token 0
   */
  public get token1LpPrice(): Price<Token, Token> {
    return new Price(this.token1, this.token0, this.tokenAmounts[1].numerator, this.tokenAmounts[0].numerator)
  }

  /**
   * Return the price of the given token in terms of the other token in the pair.
   * @param token token to return price of
   */
  public priceOf(token: Token): Price<Token, Token> {
    invariant(this.involvesToken(token), 'TOKEN')
    return token.equals(this.token0) ? this.token0Price : this.token1Price
  }

  /**
   * Return the price of the given token in terms of the other token in the pair.
   * @param token token to return price of
   */
  public lpPriceOf(token: Token): Price<Token, Token> {
    invariant(this.involvesToken(token), 'TOKEN')
    return token.equals(this.token0) ? this.token0LpPrice : this.token1LpPrice
  }

  /**
   * Returns the chain ID of the tokens in the pair.
   */
  public get chainId(): SupportedChainId {
    return this.token0.chainId
  }

  public get token0(): Token {
    return this.tokenAmounts[0].currency
  }

  public get token1(): Token {
    return this.tokenAmounts[1].currency
  }

  public get reserve0(): CurrencyAmount<Token> {
    return this.tokenAmounts[0]
  }

  public get reserve1(): CurrencyAmount<Token> {
    return this.tokenAmounts[1]
  }

  public reserveOf(token: Token): CurrencyAmount<Token> {
    invariant(this.involvesToken(token), 'TOKEN')
    return token.equals(this.token0) ? this.reserve0 : this.reserve1
  }

  /*
    Returns 
     1. amounts of output tokens in the ideal case (this value can exceed reserveOut)
     2. amounts of output tokens that will be received from this trade (this value cannot exceed reserveOut)
  */
  public getOutputAmount(amountIn: CurrencyAmount<Token>): [CurrencyAmount<Token>, CurrencyAmount<Token>, Pair] {
    invariant(this.involvesToken(amountIn.currency), 'TOKEN')
    if (JSBI.equal(this.reserve0.numerator, ZERO) && JSBI.equal(this.reserve1.numerator, ZERO)) {
      throw new InsufficientReservesError()
    }

    let isMatch: boolean = amountIn.currency.equals(this.token0)

    // Trade occurs with 0 output if trades arent not allowed
    if (
      (this.tradeState === TradeState.SELL_TOKEN_0 && isMatch) ||
      (this.tradeState === TradeState.SELL_TOKEN_1 && !isMatch) ||
      this.tradeState === TradeState.SELL_NONE
    ) {
      throw new TradeNotSupportedError()
    }

    let reserveIn: CurrencyAmount<Token> = this.reserveOf(amountIn.currency)
    let reserveOut: CurrencyAmount<Token> = this.reserveOf(isMatch ? this.token1 : this.token0)

    let reserveInJSBI: JSBI = reserveIn.numerator
    let reserveOutJSBI: JSBI = reserveOut.numerator

    let amountInPostFee = JSBI.multiply(amountIn.numerator, JSBI.BigInt(10000 - this.fee))

    let term: JSBI = ZERO
    let amountOutFirstTrade: JSBI = ZERO

    if (this.isXybk) {
      if (
        JSBI.greaterThanOrEqual(
          JSBI.add(amountInPostFee, JSBI.multiply(reserveInJSBI, _10000)),
          JSBI.multiply(this.sqrtK, _10000)
        )
      ) {
        term = this.artiLiquidityTerm(isMatch ? this.boost0 : this.boost1)

        if (JSBI.greaterThan(this.sqrtK, reserveInJSBI) && this.boost0 !== this.boost1) {
          amountOutFirstTrade = JSBI.subtract(reserveOutJSBI, this.sqrtK)
          amountInPostFee = JSBI.subtract(
            amountInPostFee,
            JSBI.multiply(JSBI.subtract(this.sqrtK, reserveInJSBI), _10000)
          )
          reserveInJSBI = this.sqrtK
          reserveOutJSBI = this.sqrtK
        }
      } else {
        term = this.artiLiquidityTerm(isMatch ? this.boost1 : this.boost0)
      }
    }

    const numerator = JSBI.multiply(amountInPostFee, JSBI.add(reserveOutJSBI, term))
    const denominator = JSBI.add(JSBI.multiply(JSBI.add(reserveInJSBI, term), _10000), amountInPostFee)
    const lastSwapAmountOut = JSBI.divide(numerator, denominator)

    const amountOut = CurrencyAmount.fromRawAmount(
      isMatch ? this.token1 : this.token0,
      JSBI.add(
        JSBI.greaterThan(lastSwapAmountOut, reserveOutJSBI) ? reserveOutJSBI : lastSwapAmountOut,
        amountOutFirstTrade
      )
    )

    if (JSBI.equal(amountOut.numerator, ZERO)) {
      throw new InsufficientInputAmountError()
    }

    return [
      amountOut,
      CurrencyAmount.fromRawAmount(
        isMatch ? this.token1 : this.token0,
        JSBI.add(lastSwapAmountOut, amountOutFirstTrade)
      ),
      new Pair(
        reserveOut.subtract(amountOut),
        reserveIn.add(amountIn),
        this.isXybk,
        this.fee,
        this.boost0,
        this.boost1,
        this.tradeState
      )
    ]
  }

  public getInputAmount(amountOut: CurrencyAmount<Token>): [CurrencyAmount<Token>, Pair] {
    invariant(this.involvesToken(amountOut.currency), 'TOKEN')

    const isMatch: Boolean = amountOut.currency.equals(this.token1) // Standardize with router

    // Trade occurs with 0 output if trades arent not allowed
    if (
      (this.tradeState === TradeState.SELL_TOKEN_0 && isMatch) ||
      (this.tradeState === TradeState.SELL_TOKEN_1 && !isMatch) ||
      this.tradeState === TradeState.SELL_NONE
    ) {
      throw new TradeNotSupportedError()
    }

    const reserveOut: CurrencyAmount<Token> = this.reserveOf(amountOut.currency)
    const reserveIn: CurrencyAmount<Token> = this.reserveOf(isMatch ? this.token0 : this.token1)

    let reserveOutJSBI: JSBI = reserveOut.numerator
    let reserveInJSBI: JSBI = reserveIn.numerator

    let term: JSBI = ZERO
    let amountInFirstTrade: JSBI = ZERO
    let amountOutJSBI: JSBI = amountOut.numerator

    if (
      (JSBI.equal(this.reserve0.numerator, ZERO) && JSBI.equal(this.reserve1.numerator, ZERO)) ||
      JSBI.greaterThan(amountOutJSBI, reserveOutJSBI)
    ) {
      throw new InsufficientReservesError()
    }

    if (this.isXybk) {
      if (JSBI.greaterThanOrEqual(reserveOutJSBI, JSBI.add(amountOut.numerator, this.sqrtK))) {
        term = this.artiLiquidityTerm(isMatch ? this.boost1 : this.boost0)
      } else {
        term = this.artiLiquidityTerm(isMatch ? this.boost0 : this.boost1)
        if (this.boost0 !== this.boost1 && JSBI.greaterThan(reserveOutJSBI, this.sqrtK)) {
          amountInFirstTrade = JSBI.multiply(JSBI.subtract(this.sqrtK, reserveInJSBI), _10000)
          amountOutJSBI = JSBI.subtract(amountOutJSBI, JSBI.subtract(reserveOutJSBI, this.sqrtK))
          reserveInJSBI = this.sqrtK
          reserveOutJSBI = this.sqrtK
        }
      }
    }

    const numerator = JSBI.multiply(JSBI.add(reserveInJSBI, term), JSBI.multiply(amountOutJSBI, _10000))
    const denominator = JSBI.subtract(JSBI.add(reserveOutJSBI, term), amountOutJSBI)

    const inputAmount = CurrencyAmount.fromRawAmount(
      isMatch ? this.token0 : this.token1,
      JSBI.add(
        JSBI.divide(JSBI.add(amountInFirstTrade, JSBI.divide(numerator, denominator)), JSBI.BigInt(10000 - this.fee)),
        ONE
      )
    )

    return [
      inputAmount,
      new Pair(
        reserveIn.add(inputAmount),
        reserveOut.subtract(amountOut),
        this.isXybk,
        this.fee,
        this.boost0,
        this.boost1,
        this.tradeState
      )
    ]
  }

  /*
   * Unchanged from pancake/uni
   */
  public getLiquidityMinted(
    totalSupply: CurrencyAmount<Token>,
    tokenAmountA: CurrencyAmount<Token>,
    tokenAmountB: CurrencyAmount<Token>
  ): CurrencyAmount<Token> {
    invariant(totalSupply.currency.equals(this.liquidityToken), 'LIQUIDITY')
    const tokenAmounts = tokenAmountA.currency.sortsBefore(tokenAmountB.currency) // does safety checks
      ? [tokenAmountA, tokenAmountB]
      : [tokenAmountB, tokenAmountA]
    invariant(tokenAmounts[0].currency.equals(this.token0) && tokenAmounts[1].currency.equals(this.token1), 'TOKEN')

    let liquidity: JSBI
    if (JSBI.equal(totalSupply.numerator, ZERO)) {
      liquidity = JSBI.subtract(
        sqrt(JSBI.multiply(tokenAmounts[0].numerator, tokenAmounts[1].numerator)),
        MINIMUM_LIQUIDITY
      )
    } else {
      const amount0 = JSBI.equal(this.reserve0.numerator, ZERO)
        ? JSBI.exponentiate(TWO, JSBI.BigInt(255))
        : JSBI.divide(JSBI.multiply(tokenAmounts[0].numerator, totalSupply.numerator), this.reserve0.numerator)
      const amount1 = JSBI.equal(this.reserve1.numerator, ZERO)
        ? JSBI.exponentiate(TWO, JSBI.BigInt(255))
        : JSBI.divide(JSBI.multiply(tokenAmounts[1].numerator, totalSupply.numerator), this.reserve1.numerator)
      liquidity = JSBI.lessThanOrEqual(amount0, amount1) ? amount0 : amount1
    }
    // if (!JSBI.greaterThan(liquidity, ZERO)) {
    //   throw new InsufficientInputAmountError()
    // }
    return CurrencyAmount.fromRawAmount(this.liquidityToken, liquidity)
  }

  /*
   * Unchanged from pancake/uni
   */
  public getLiquidityValue(
    token: Token,
    totalSupply: CurrencyAmount<Token>,
    liquidity: CurrencyAmount<Token>,
    feeOn: boolean = false,
    kLast?: BigintIsh
  ): CurrencyAmount<Token> {
    invariant(this.involvesToken(token), 'TOKEN')
    invariant(totalSupply.currency.equals(this.liquidityToken), 'TOTAL_SUPPLY')
    invariant(liquidity.currency.equals(this.liquidityToken), 'LIQUIDITY')
    invariant(JSBI.lessThanOrEqual(liquidity.numerator, totalSupply.numerator), 'LIQUIDITY')

    let totalSupplyAdjusted: CurrencyAmount<Token>
    if (!feeOn) {
      totalSupplyAdjusted = totalSupply
    } else {
      invariant(!!kLast, 'K_LAST')
      const kLastParsed = parseBigintIsh(kLast)
      if (!JSBI.equal(kLastParsed, ZERO)) {
        const rootK = sqrt(JSBI.multiply(this.reserve0.numerator, this.reserve1.numerator))
        const rootKLast = sqrt(kLastParsed)
        if (JSBI.greaterThan(rootK, rootKLast)) {
          const numerator = JSBI.multiply(totalSupply.numerator, JSBI.subtract(rootK, rootKLast))
          const denominator = JSBI.add(JSBI.multiply(rootK, FIVE), rootKLast)
          const feeLiquidity = JSBI.divide(numerator, denominator)
          totalSupplyAdjusted = totalSupply.add(CurrencyAmount.fromRawAmount(this.liquidityToken, feeLiquidity))
        } else {
          totalSupplyAdjusted = totalSupply
        }
      } else {
        totalSupplyAdjusted = totalSupply
      }
    }

    return CurrencyAmount.fromRawAmount(
      token,
      JSBI.divide(JSBI.multiply(liquidity.numerator, this.reserveOf(token).numerator), totalSupplyAdjusted.numerator)
    )
  }
}
