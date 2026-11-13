import type { LedgerEntry } from "./entries.ts";

/*
 * 精算の計算。1か月分の記録から、人ごとの収支を出し、それを支払いの一覧にまとめる。
 */

/** 1回の支払い。fromIdの人が、toIdの人にamount円を支払う */
export interface Transfer {
	fromId: string;
	toId: string;
	amount: number;
}

/**
 * 人ごとの収支を出す。おごった額はプラス、おごられた額はマイナスとして足し合わせる。
 * 全員の収支を足すと、必ず0になる。
 */
export function computeBalances(
	entries: readonly LedgerEntry[],
): Map<string, number> {
	const balances = new Map<string, number>();
	for (const entry of entries) {
		balances.set(
			entry.payerId,
			(balances.get(entry.payerId) ?? 0) + entry.amount,
		);
		balances.set(
			entry.debtorId,
			(balances.get(entry.debtorId) ?? 0) - entry.amount,
		);
	}
	return balances;
}

/**
 * 収支を、支払いの一覧にまとめる。収支がマイナスの人が支払い、プラスの人が受け取る。
 * 払う額の大きい人から順に、受け取る額の大きい人へ割り当てるので、支払いの回数は多くても「人数 - 1」回になる。
 * そのため、おごった・おごられたの関係がない人どうしの支払いになることもある。
 * 同じ額なら、IDの順に並べる(同じ台帳から、いつも同じ結果を出すため)。
 */
export function computeTransfers(
	balances: ReadonlyMap<string, number>,
): Transfer[] {
	const byAmount = (
		a: { id: string; amount: number },
		b: { id: string; amount: number },
	) => b.amount - a.amount || compareIds(a.id, b.id);
	const payers = [...balances]
		.filter(([, balance]) => balance < 0)
		.map(([id, balance]) => ({ id, amount: -balance }))
		.sort(byAmount);
	const receivers = [...balances]
		.filter(([, balance]) => balance > 0)
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
		const amount = Math.min(payer.amount, receiver.amount);
		transfers.push({ fromId: payer.id, toId: receiver.id, amount });
		payer.amount -= amount;
		receiver.amount -= amount;
		if (payer.amount === 0) {
			p++;
		}
		if (receiver.amount === 0) {
			r++;
		}
	}
	return transfers;
}

/** DiscordのID(数字の文字列)を、数として比べる */
function compareIds(a: string, b: string): number {
	return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}
