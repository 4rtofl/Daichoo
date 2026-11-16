import type { LedgerEntry } from "./entries.ts";

/*
 * 精算の計算。1か月分の記録から、人ごとの収支を出し、それを支払いの一覧にまとめる。
 *
 * 割り勘の1人分(amount ÷ split)は1円で割り切れないことがあるので、収支は分数のまま正確に足していく。
 * 浮動小数点で足すと誤差が出て、ちょうど0.5円かどうかの判定が狂うため、整数(BigInt)の分子と、
 * その月の記録に共通の分母で持つ。円に丸めるのは、最後に支払い1回ごとの額を決めるときだけで、
 * 丸め方は偶数丸め(銀行丸め)にする。
 */

/** 1回の支払い。fromIdの人が、toIdの人にamount円を支払う */
export interface Transfer {
	fromId: string;
	toId: string;
	amount: number;
}

/**
 * 人ごとの収支。amounts の値を denominator で割ったものが、その人の収支(円)になる。
 * おごった額はプラス、おごられた額はマイナス。全員の収支を足すと、必ず0になる。
 */
export interface Balances {
	denominator: bigint;
	amounts: Map<string, bigint>;
}

/**
 * 人ごとの収支を出す。1行の記録で、おごられた人は amount ÷ split 円をおごった人から借りたことになる。
 * /ogori の記録は split が1なので、amount 円をそのまま借りる。
 */
export function computeBalances(entries: readonly LedgerEntry[]): Balances {
	// 分母は、どの行の split でも割り切れる数(最小公倍数)にする
	const denominator = entries.reduce(
		(d, entry) => lcm(d, BigInt(entry.split)),
		1n,
	);
	const amounts = new Map<string, bigint>();
	for (const entry of entries) {
		const share = (BigInt(entry.amount) * denominator) / BigInt(entry.split);
		amounts.set(entry.payerId, (amounts.get(entry.payerId) ?? 0n) + share);
		amounts.set(entry.debtorId, (amounts.get(entry.debtorId) ?? 0n) - share);
	}
	return { denominator, amounts };
}

/**
 * 収支を、支払いの一覧にまとめる。収支がマイナスの人が支払い、プラスの人が受け取る。
 * 払う額の大きい人から順に、受け取る額の大きい人へ割り当てるので、支払いの回数は多くても「人数 - 1」回になる。
 * そのため、おごった・おごられたの関係がない人どうしの支払いになることもある。
 * 同じ額なら、IDの順に並べる(同じ台帳から、いつも同じ結果を出すため)。
 *
 * 割り当ては分数のまま正確に行い、決まった支払い1回ずつの額を、偶数丸めで円にする。
 * 支払う側と受け取る側は同じ支払いを見るので、丸めたあとも、払う額の合計と受け取る額の合計は一致する。
 * 丸めて0円になった支払いは載せない。
 */
export function computeTransfers(balances: Balances): Transfer[] {
	const byAmount = (
		a: { id: string; amount: bigint },
		b: { id: string; amount: bigint },
	) => compareBigInt(b.amount, a.amount) || compareIds(a.id, b.id);
	const payers = [...balances.amounts]
		.filter(([, balance]) => balance < 0n)
		.map(([id, balance]) => ({ id, amount: -balance }))
		.sort(byAmount);
	const receivers = [...balances.amounts]
		.filter(([, balance]) => balance > 0n)
		.map(([id, balance]) => ({ id, amount: balance }))
		.sort(byAmount);

	const transfers: Transfer[] = [];
	let p = 0;
	let r = 0;
	while (p < payers.length && r < receivers.length) {
		const payer = payers[p];
		const receiver = receivers[r];
		if (!payer || !receiver) {
			break;
		}
		const exact = minBigInt(payer.amount, receiver.amount);
		const amount = roundHalfEven(exact, balances.denominator);
		if (amount > 0) {
			transfers.push({ fromId: payer.id, toId: receiver.id, amount });
		}
		payer.amount -= exact;
		receiver.amount -= exact;
		if (payer.amount === 0n) {
			p++;
		}
		if (receiver.amount === 0n) {
			r++;
		}
	}
	return transfers;
}

/**
 * 0以上の分数 numerator ÷ denominator を、偶数丸め(銀行丸め)で整数にする。
 * ちょうど0.5のときは、偶数のほうに寄せる(0.5 → 0、1.5 → 2、2.5 → 2)。それ以外は近いほうにする。
 */
export function roundHalfEven(numerator: bigint, denominator: bigint): number {
	if (numerator < 0n || denominator <= 0n) {
		throw new RangeError("roundHalfEven: 0以上の分数を渡してください");
	}
	const quotient = numerator / denominator;
	const twiceRemainder = (numerator % denominator) * 2n;
	const roundUp =
		twiceRemainder > denominator ||
		(twiceRemainder === denominator && quotient % 2n === 1n);
	return Number(roundUp ? quotient + 1n : quotient);
}

/** DiscordのID(数字の文字列)を、数として比べる */
export function compareIds(a: string, b: string): number {
	return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

/** Math.min は bigint を受け付けないので、自分で比べる */
function minBigInt(a: bigint, b: bigint): bigint {
	return compareBigInt(a, b) <= 0 ? a : b;
}

function compareBigInt(a: bigint, b: bigint): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function gcd(a: bigint, b: bigint): bigint {
	let x = a;
	let y = b;
	while (y !== 0n) {
		[x, y] = [y, x % y];
	}
	return x;
}

function lcm(a: bigint, b: bigint): bigint {
	return (a / gcd(a, b)) * b;
}
