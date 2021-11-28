import { Price } from './fractions/price'
import { TokenAmount } from './fractions/tokenAmount'
import invariant from 'tiny-invariant'
import JSBI from 'jsbi'
import { pack, keccak256 } from '@ethersproject/solidity'
import { getCreate2Address } from '@ethersproject/address'

import {
  BigintIsh,
  FACTORY_ADDRESS,
  INIT_CODE_HASH,
  MINIMUM_LIQUIDITY,
  ZERO,
  ONE,
  TWO,
  FIVE,
  EIGHT,
  _10000,
  ChainId
} from '../constants'
import { sqrt, parseBigintIsh } from '../utils'
import { InsufficientReservesError, InsufficientInputAmountError } from '../errors'
import { Token } from './token'

let PAIR_ADDRESS_CACHE: { [token0Address: string]: { [token1Address: string]: string } } = {}

export class Pair {
  public readonly liquidityToken: Token
  public readonly isXybk: Boolean
  public readonly fee: number
  public readonly boost0: number
  public readonly boost1: number
  public readonly SqrtK: JSBI

  private readonly tokenAmounts: [TokenAmount, TokenAmount]

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
    tokenAmountA: TokenAmount,
    tokenAmountB: TokenAmount,
    isXybk: Boolean,
    fee: number,
    boost0: number,
    boost1: number
  ) {
    const tokenAmounts = tokenAmountA.token.sortsBefore(tokenAmountB.token) // does safety checks
      ? [tokenAmountA, tokenAmountB]
      : [tokenAmountB, tokenAmountA]
    this.liquidityToken = new Token(
      tokenAmounts[0].token.chainId,
      Pair.getAddress(tokenAmounts[0].token, tokenAmounts[1].token),
      18,
      'IF-LP',
      'Impossible Swap LPs'
    )
    this.tokenAmounts = tokenAmounts as [TokenAmount, TokenAmount]
    this.isXybk = isXybk
    this.fee = fee
    this.boost0 = boost0
    this.boost1 = boost1
    this.SqrtK = this.computeXybkSqrtK(boost0, boost1)
  }

  /**
   * Calculates xybk SqrtK from reserve0, reserve1
   */
  private computeXybkSqrtK(b0: number, b1: number): JSBI {
    let boost: number = JSBI.greaterThan(this.tokenAmounts[0].raw, this.tokenAmounts[1].raw) ? b0 : b1
    if (boost === 1) {
      return ONE
    }

    const multiplier: JSBI = JSBI.BigInt(10000000000)
    const amount0: JSBI = JSBI.multiply(this.tokenAmounts[0].raw, multiplier)
    const amount1: JSBI = JSBI.multiply(this.tokenAmounts[1].raw, multiplier)

    let term: JSBI = JSBI.divide(
      JSBI.multiply(JSBI.BigInt(boost - 1), JSBI.add(amount0, amount1)),
      JSBI.BigInt(boost * 4 - 2)
    )

    let result: JSBI = JSBI.add(
      JSBI.divide(JSBI.multiply(amount0, amount1), JSBI.BigInt(boost * 2 - 1)),
      JSBI.exponentiate(term, TWO)
    )

    return JSBI.divide(JSBI.add(this.sqrt(result), JSBI.BigInt(term)), multiplier)
  }

  /**
   * Returns artificial liquidity term [(boost-1)*SqrtK] to be added to real reserves for xybk invariant
   */
  public artiLiquidityTerm(boost: number): JSBI {
    return JSBI.multiply(JSBI.BigInt(boost - 1), this.SqrtK)
  }

  public getBoost(): number {
    return JSBI.greaterThan(this.tokenAmounts[0].raw, this.tokenAmounts[1].raw) ? this.boost0 : this.boost1
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
   * Returns the price of token 0 in token 1
   */
  public get token0Price(): Price {
    if (this.isXybk) {
      let term: JSBI = this.artiLiquidityTerm(this.getBoost())
      return new Price(
        this.token0,
        this.token1,
        JSBI.add(this.tokenAmounts[0].raw, term),
        JSBI.add(this.tokenAmounts[1].raw, term)
      )
    } else {
      return this.token0LpPrice
    }
  }

  /**
   * Returns the uni prices of token 0 in token 1
   */
  public get token0LpPrice(): Price {
    return new Price(this.token0, this.token1, this.tokenAmounts[0].raw, this.tokenAmounts[1].raw)
  }

  /**
   * Returns the current mid price of the pair in terms of token1, i.e. the ratio of reserve0 to reserve1
   */
  public get token1Price(): Price {
    if (this.isXybk) {
      let term: JSBI = this.artiLiquidityTerm(this.getBoost())
      return new Price(
        this.token1,
        this.token0,
        JSBI.add(this.tokenAmounts[1].raw, term),
        JSBI.add(this.tokenAmounts[0].raw, term)
      )
    } else {
      return this.token1LpPrice
    }
  }

  /**
   * Returns the uni prices of token 0 in token 1
   */
  public get token1LpPrice(): Price {
    return new Price(this.token1, this.token0, this.tokenAmounts[1].raw, this.tokenAmounts[0].raw)
  }

  /**
   * Return the price of the given token in terms of the other token in the pair.
   * @param token token to return price of
   */
  public priceOf(token: Token): Price {
    invariant(this.involvesToken(token), 'TOKEN')
    return token.equals(this.token0) ? this.token0Price : this.token1Price
  }

  /**
   * Return the price of the given token in terms of the other token in the pair.
   * @param token token to return price of
   */
  public lpPriceOf(token: Token): Price {
    invariant(this.involvesToken(token), 'TOKEN')
    return token.equals(this.token0) ? this.token0LpPrice : this.token1LpPrice
  }

  /**
   * Returns the chain ID of the tokens in the pair.
   */
  public get chainId(): ChainId {
    return this.token0.chainId
  }

  public get token0(): Token {
    return this.tokenAmounts[0].token
  }

  public get token1(): Token {
    return this.tokenAmounts[1].token
  }

  public get reserve0(): TokenAmount {
    return this.tokenAmounts[0]
  }

  public get reserve1(): TokenAmount {
    return this.tokenAmounts[1]
  }

  public reserveOf(token: Token): TokenAmount {
    invariant(this.involvesToken(token), 'TOKEN')
    return token.equals(this.token0) ? this.reserve0 : this.reserve1
  }

  public getOutputAmount(inputAmount: TokenAmount): [TokenAmount, Pair] {
    invariant(this.involvesToken(inputAmount.token), 'TOKEN')
    if (JSBI.equal(this.reserve0.raw, ZERO) || JSBI.equal(this.reserve1.raw, ZERO)) {
      throw new InsufficientReservesError()
    }
    let inputReserve: TokenAmount = this.reserveOf(inputAmount.token)
    let outputReserve: TokenAmount = this.reserveOf(inputAmount.token.equals(this.token0) ? this.token1 : this.token0)

    let outputReserveJSBI: JSBI = outputReserve.raw
    let inputReserveJSBI: JSBI = inputReserve.raw

    let outputAmountJSBI: JSBI = JSBI.BigInt(0)
    let inputAmountWithFee = JSBI.multiply(inputAmount.raw, JSBI.BigInt(10000 - this.fee))

    const isMatch: Boolean = inputAmount.token.equals(this.token0)
    if (this.isXybk) {
      // If inputAmountWithFee + 10000*reserveIn >= SqrtK*10000
      if (
        JSBI.greaterThan(
          JSBI.add(inputAmountWithFee, JSBI.multiply(inputReserveJSBI, _10000)),
          JSBI.multiply(this.SqrtK, _10000)
        )
      ) {
        // If balance started from <SqrtK and ended at >SqrtK and boosts are different, there'll be different amountIn/Out
        // Don't need to check in other case for reserveIn < reserveIn.add(x) <= SqrtK since that case doesnt cross midpt
        if (this.boost0 !== this.boost1 && JSBI.greaterThan(this.SqrtK, inputReserveJSBI)) {
          outputAmountJSBI = JSBI.subtract(outputReserveJSBI, this.SqrtK)
          let diff: TokenAmount = new TokenAmount(inputAmount.token, JSBI.subtract(this.SqrtK, inputReserveJSBI))
          inputAmountWithFee = JSBI.subtract(inputAmountWithFee, JSBI.multiply(diff.raw, _10000)) // This is multiplied by 10k
          inputAmount.add(diff)
          inputReserve.add(diff)
          // If tokenIn = token0, balanceIn > sqrtK => balance0>sqrtK, use boost0
          let term: JSBI = this.artiLiquidityTerm(isMatch ? this.boost0 : this.boost1)
          outputReserveJSBI = JSBI.add(this.SqrtK, term)
          inputReserveJSBI = JSBI.add(this.SqrtK, term) // Does this work?
        } else {
          // If tokenIn = token0, balanceIn > sqrtK => balance0>sqrtK, use boost0
          let term: JSBI = this.artiLiquidityTerm(isMatch ? this.boost0 : this.boost1)
          inputReserveJSBI = JSBI.add(inputReserveJSBI, term)
          outputReserveJSBI = JSBI.add(outputReserveJSBI, term)
        }
      } else {
        // If tokenIn = token0, balanceIn < sqrtK => balance0<sqrtK, use boost1
        let term: JSBI = this.artiLiquidityTerm(isMatch ? this.boost1 : this.boost0)
        inputReserveJSBI = JSBI.add(inputReserveJSBI, term)
        outputReserveJSBI = JSBI.add(outputReserveJSBI, term)
      }
    }
    const numerator = JSBI.multiply(inputAmountWithFee, outputReserveJSBI)
    const denominator = JSBI.add(JSBI.multiply(inputReserveJSBI, _10000), inputAmountWithFee)
    const outputVal = JSBI.add(outputAmountJSBI, JSBI.divide(numerator, denominator))

    const outputAmount = new TokenAmount(
      inputAmount.token.equals(this.token0) ? this.token1 : this.token0,
      JSBI.greaterThan(outputReserve.raw, outputVal) ? outputVal : outputReserve.raw
    )

    if (JSBI.equal(outputAmount.raw, ZERO)) {
      throw new InsufficientInputAmountError()
    }
    return [
      outputAmount,
      new Pair(
        inputReserve.add(inputAmount),
        outputReserve.subtract(outputAmount),
        this.isXybk,
        this.fee,
        this.boost0,
        this.boost1
      )
    ]
  }

  public getInputAmount(outputAmount: TokenAmount): [TokenAmount, Pair] {
    invariant(this.involvesToken(outputAmount.token), 'TOKEN')
    if (
      JSBI.equal(this.reserve0.raw, ZERO) ||
      JSBI.equal(this.reserve1.raw, ZERO) ||
      JSBI.greaterThanOrEqual(outputAmount.raw, this.reserveOf(outputAmount.token).raw)
    ) {
      throw new InsufficientReservesError()
    }

    let outputReserve: TokenAmount = this.reserveOf(outputAmount.token)
    const inputReserve: TokenAmount = this.reserveOf(outputAmount.token.equals(this.token0) ? this.token1 : this.token0)

    let outputReserveJSBI: JSBI = outputReserve.raw
    let inputReserveJSBI: JSBI = inputReserve.raw

    const isMatch: Boolean = outputAmount.token.equals(this.token0)
    let inputAmountJSBI: JSBI = JSBI.BigInt(0)
    if (this.isXybk) {
      // If reserveOut - amountOut >= SqrtK
      if (JSBI.greaterThan(JSBI.subtract(outputReserveJSBI, outputAmount.raw), this.SqrtK)) {
        // If tokenOut == token0, balanceOut > sqrtK => balance1>sqrtK, use boost1
        let term: JSBI = this.artiLiquidityTerm(isMatch ? this.boost0 : this.boost1)
        inputReserveJSBI = JSBI.add(inputReserveJSBI, term)
        outputReserveJSBI = JSBI.add(outputReserveJSBI, term)
      } else {
        // If balance started from <SqrtK and ended at >SqrtK and boosts are different, there'll be different amountIn/Out
        // Don't need to check in other case for reserveOut > reserveOut.sub(x) >= sqrtK since that case doesnt cross midpt
        if (this.boost0 !== this.boost1 && JSBI.greaterThan(outputReserveJSBI, this.SqrtK)) {
          // Break into 2 trades => start point -> midpoint (SqrtK, SqrtK), then midpoint -> final point
          let diff: TokenAmount = new TokenAmount(outputAmount.token, JSBI.subtract(outputReserveJSBI, this.SqrtK))
          outputAmount = outputAmount.subtract(diff)
          outputReserve = outputReserve.subtract(diff)
          outputReserveJSBI = JSBI.subtract(outputReserveJSBI, diff.raw)
          inputAmountJSBI = JSBI.divide(
            JSBI.multiply(JSBI.subtract(this.SqrtK, inputReserveJSBI), _10000),
            JSBI.BigInt(10000 - this.fee)
          )
          // If tokenOut = token0, balanceOut < sqrtK => balance0<sqrtK, use boost1
          let term: JSBI = this.artiLiquidityTerm(isMatch ? this.boost1 : this.boost0)
          outputReserveJSBI = JSBI.add(this.SqrtK, term)
          inputReserveJSBI = JSBI.add(this.SqrtK, term) // Does this work?
        } else {
          // If tokenOut = token0, balanceOut < sqrtK => balance0<sqrtK, use boost1
          let term: JSBI = this.artiLiquidityTerm(isMatch ? this.boost1 : this.boost0)
          inputReserveJSBI = JSBI.add(inputReserveJSBI, term)
          outputReserveJSBI = JSBI.add(outputReserveJSBI, term)
        }
      }
    }
    const numerator = JSBI.multiply(JSBI.multiply(inputReserveJSBI, outputAmount.raw), _10000)
    const denominator = JSBI.multiply(JSBI.subtract(outputReserveJSBI, outputAmount.raw), JSBI.BigInt(10000 - this.fee))
    const inputAmount = new TokenAmount(
      outputAmount.token.equals(this.token0) ? this.token1 : this.token0,
      JSBI.add(inputAmountJSBI, JSBI.add(JSBI.divide(numerator, denominator), ONE))
    )
    return [
      inputAmount,
      new Pair(
        inputReserve.add(inputAmount),
        outputReserve.subtract(outputAmount),
        this.isXybk,
        this.fee,
        this.boost0,
        this.boost1
      )
    ]
  }

  /*
   * Unchanged from pancake/uni
   */
  public getLiquidityMinted(
    totalSupply: TokenAmount,
    tokenAmountA: TokenAmount,
    tokenAmountB: TokenAmount
  ): TokenAmount {
    invariant(totalSupply.token.equals(this.liquidityToken), 'LIQUIDITY')
    const tokenAmounts = tokenAmountA.token.sortsBefore(tokenAmountB.token) // does safety checks
      ? [tokenAmountA, tokenAmountB]
      : [tokenAmountB, tokenAmountA]
    invariant(tokenAmounts[0].token.equals(this.token0) && tokenAmounts[1].token.equals(this.token1), 'TOKEN')

    let liquidity: JSBI
    if (JSBI.equal(totalSupply.raw, ZERO)) {
      liquidity = JSBI.subtract(sqrt(JSBI.multiply(tokenAmounts[0].raw, tokenAmounts[1].raw)), MINIMUM_LIQUIDITY)
    } else {
      const amount0 = JSBI.divide(JSBI.multiply(tokenAmounts[0].raw, totalSupply.raw), this.reserve0.raw)
      const amount1 = JSBI.divide(JSBI.multiply(tokenAmounts[1].raw, totalSupply.raw), this.reserve1.raw)
      liquidity = JSBI.lessThanOrEqual(amount0, amount1) ? amount0 : amount1
    }
    if (!JSBI.greaterThan(liquidity, ZERO)) {
      throw new InsufficientInputAmountError()
    }
    return new TokenAmount(this.liquidityToken, liquidity)
  }

  /*
   * Unchanged from pancake/uni
   */
  public getLiquidityValue(
    token: Token,
    totalSupply: TokenAmount,
    liquidity: TokenAmount,
    feeOn: boolean = false,
    kLast?: BigintIsh
  ): TokenAmount {
    invariant(this.involvesToken(token), 'TOKEN')
    invariant(totalSupply.token.equals(this.liquidityToken), 'TOTAL_SUPPLY')
    invariant(liquidity.token.equals(this.liquidityToken), 'LIQUIDITY')
    invariant(JSBI.lessThanOrEqual(liquidity.raw, totalSupply.raw), 'LIQUIDITY')

    let totalSupplyAdjusted: TokenAmount
    if (!feeOn) {
      totalSupplyAdjusted = totalSupply
    } else {
      invariant(!!kLast, 'K_LAST')
      const kLastParsed = parseBigintIsh(kLast)
      if (!JSBI.equal(kLastParsed, ZERO)) {
        const rootK = sqrt(JSBI.multiply(this.reserve0.raw, this.reserve1.raw))
        const rootKLast = sqrt(kLastParsed)
        if (JSBI.greaterThan(rootK, rootKLast)) {
          const numerator = JSBI.multiply(totalSupply.raw, JSBI.subtract(rootK, rootKLast))
          const denominator = JSBI.add(JSBI.multiply(rootK, FIVE), rootKLast)
          const feeLiquidity = JSBI.divide(numerator, denominator)
          totalSupplyAdjusted = totalSupply.add(new TokenAmount(this.liquidityToken, feeLiquidity))
        } else {
          totalSupplyAdjusted = totalSupply
        }
      } else {
        totalSupplyAdjusted = totalSupply
      }
    }

    return new TokenAmount(
      token,
      JSBI.divide(JSBI.multiply(liquidity.raw, this.reserveOf(token).raw), totalSupplyAdjusted.raw)
    )
  }
}
