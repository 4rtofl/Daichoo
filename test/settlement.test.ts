import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "../src/ledger/entries.ts";
import {
	computeBalances,
	computeTransfers,
	type Transfer,
} from "../src/ledger/settlement.ts";

let nextId = 1;

/** payerがdebtorにamount円おごった記録 */
function treat(payerId: string, debtorId: string, amount: number): LedgerEntry {
	return {
		id: String(nextId++),
		recordedAt: "",
		payerId,
		payerName: "",
		debtorId,
		debtorName: "",
		amount,
		memo: "",
	};
}

function settle(entries: LedgerEntry[]): Transfer[] {
	return computeTransfers(computeBalances(entries));
}

describe("computeBalances", () => {
	it("おごった額はプラス、おごられた額はマイナス", () => {
		const balances = computeBalances([
			treat("1", "2", 1000),
			treat("2", "1", 300),
			treat("1", "3", 500),
		]);
		expect(Object.fromEntries(balances)).toEqual({
			"1": 1200,
			"2": -700,
			"3": -500,
		});
	});
});

describe("computeTransfers", () => {
	it("おごられた人が、おごった人に支払う", () => {
		expect(settle([treat("1", "2", 1200)])).toEqual([
			{ fromId: "2", toId: "1", amount: 1200 },
		]);
	});

	it("お互いにおごった分は差し引く", () => {
		expect(settle([treat("1", "2", 1000), treat("2", "1", 300)])).toEqual([
			{ fromId: "2", toId: "1", amount: 700 },
		]);
	});

	it("同じ額をおごり合ったら、支払いはない", () => {
		expect(settle([treat("1", "2", 500), treat("2", "1", 500)])).toEqual([]);
		expect(settle([])).toEqual([]);
	});

	it("貸し借りをまとめて、支払いの回数を減らす", () => {
		// 1が2に、2が3におごった。2の収支は0なので、3から1へ直接支払う
		expect(settle([treat("1", "2", 1000), treat("2", "3", 1000)])).toEqual([
			{ fromId: "3", toId: "1", amount: 1000 },
		]);
	});

	it("払う額の大きい人から、受け取る額の大きい人へ割り当てる", () => {
		// 収支は 1: +4000、2: +2000、3: -3000、4: -3000
		expect(
			settle([
				treat("1", "3", 3000),
				treat("1", "4", 1000),
				treat("2", "4", 2000),
			]),
		).toEqual([
			{ fromId: "3", toId: "1", amount: 3000 },
			{ fromId: "4", toId: "1", amount: 1000 },
			{ fromId: "4", toId: "2", amount: 2000 },
		]);
	});

	it("同じ額の人どうしは、IDを数として比べた順に並べる", () => {
		// 文字列として比べると "10" < "9" だが、数としては 9 < 10
		const transfers = settle([treat("5", "10", 100), treat("5", "9", 100)]);
		expect(transfers.map((t) => t.fromId)).toEqual(["9", "10"]);
	});

	it("どんな記録でも、支払うと全員の収支が0になり、回数は人数 - 1 回以下", () => {
		const random = seededRandom(42);
		for (let round = 0; round < 200; round++) {
			const people = 2 + Math.floor(random() * 8);
			const entries: LedgerEntry[] = [];
			for (let i = 0; i < 1 + Math.floor(random() * 30); i++) {
				const payer = Math.floor(random() * people);
				const debtor =
					(payer + 1 + Math.floor(random() * (people - 1))) % people;
				entries.push(
					treat(String(payer), String(debtor), 1 + Math.floor(random() * 5000)),
				);
			}
			const balances = computeBalances(entries);
			const transfers = computeTransfers(balances);
			for (const transfer of transfers) {
				expect(transfer.amount).toBeGreaterThan(0);
				balances.set(
					transfer.fromId,
					(balances.get(transfer.fromId) ?? 0) + transfer.amount,
				);
				balances.set(
					transfer.toId,
					(balances.get(transfer.toId) ?? 0) - transfer.amount,
				);
			}
			expect([...balances.values()].every((balance) => balance === 0)).toBe(
				true,
			);
			expect(transfers.length).toBeLessThanOrEqual(
				Math.max(0, balances.size - 1),
			);
		}
	});
});

/** 毎回同じ並びになる乱数(テストの結果を再現できるようにする) */
function seededRandom(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state * 1103515245 + 12345) % 2147483648;
		return state / 2147483648;
	};
}
