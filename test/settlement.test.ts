import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "../src/ledger/entries.ts";
import {
	type Balances,
	computeBalances,
	computeTransfers,
	roundHalfEven,
	type Transfer,
} from "../src/ledger/settlement.ts";

let nextId = 1;

/** payerがdebtorにamount円おごった記録。splitを渡すと、amount円をsplit人で割り勘した記録の1行 */
function treat(
	payerId: string,
	debtorId: string,
	amount: number,
	split = 1,
): LedgerEntry {
	return {
		id: String(nextId++),
		recordedAt: "",
		payerId,
		payerName: "",
		debtorId,
		debtorName: "",
		amount,
		split,
		memo: "",
	};
}

/** payerがamount円を払い、debtorIdsと割り勘した記録(払った人を含めて割る) */
function warikan(
	payerId: string,
	debtorIds: string[],
	amount: number,
): LedgerEntry[] {
	const id = String(nextId++);
	return debtorIds.map((debtorId) => ({
		...treat(payerId, debtorId, amount, debtorIds.length + 1),
		id,
	}));
}

function settle(entries: LedgerEntry[]): Transfer[] {
	return computeTransfers(computeBalances(entries));
}

/** 収支を、円の数(分数を小数にしたもの)で見る。テストで読みやすくするため */
function balancesInYen(entries: LedgerEntry[]): Record<string, number> {
	const { denominator, amounts } = computeBalances(entries);
	return Object.fromEntries(
		[...amounts].map(([id, amount]) => [
			id,
			Number(amount) / Number(denominator),
		]),
	);
}

describe("computeBalances", () => {
	it("おごった額はプラス、おごられた額はマイナス", () => {
		const entries = [
			treat("1", "2", 1000),
			treat("2", "1", 300),
			treat("1", "3", 500),
		];
		expect(computeBalances(entries).denominator).toBe(1n);
		expect(balancesInYen(entries)).toEqual({
			"1": 1200,
			"2": -700,
			"3": -500,
		});
	});

	it("割り勘では、1人分(amount ÷ split)を、割り切れなくても分数のまま足す", () => {
		// 1が1000円を1, 2, 3で割り勘を2回。2と3の分は 1000/3 + 1000/3 = 2000/3 円
		const { denominator, amounts } = computeBalances([
			...warikan("1", ["2", "3"], 1000),
			...warikan("1", ["2", "3"], 1000),
		]);
		expect(denominator).toBe(3n);
		expect(Object.fromEntries(amounts)).toEqual({
			"1": 4000n,
			"2": -2000n,
			"3": -2000n,
		});
	});

	it("分母は、どの split でも割り切れる数になる", () => {
		const { denominator, amounts } = computeBalances([
			treat("1", "2", 100, 4),
			treat("1", "2", 100, 6),
			treat("2", "1", 100),
		]);
		expect(denominator).toBe(12n);
		// 100/4 + 100/6 - 100 = -175/3 = -700/12
		expect(amounts.get("1")).toBe(-700n);
		expect(amounts.get("2")).toBe(700n);
	});

	it("全員の収支を足すと、必ず0になる", () => {
		const { amounts } = computeBalances([
			...warikan("1", ["2", "3", "4"], 1001),
			...warikan("2", ["1", "3"], 777),
			treat("4", "1", 123),
		]);
		expect([...amounts.values()].reduce((a, b) => a + b, 0n)).toBe(0n);
	});
});

describe("roundHalfEven", () => {
	it("ちょうど0.5のときは、偶数のほうに寄せる", () => {
		expect(roundHalfEven(1n, 2n)).toBe(0);
		expect(roundHalfEven(3n, 2n)).toBe(2);
		expect(roundHalfEven(5n, 2n)).toBe(2);
		expect(roundHalfEven(7n, 2n)).toBe(4);
		expect(roundHalfEven(1001n, 2n)).toBe(500);
		expect(roundHalfEven(1003n, 2n)).toBe(502);
	});

	it("0.5でなければ、近いほうにする", () => {
		expect(roundHalfEven(10000n, 3n)).toBe(3333);
		expect(roundHalfEven(20000n, 3n)).toBe(6667);
		expect(roundHalfEven(4999n, 10000n)).toBe(0);
		expect(roundHalfEven(5001n, 10000n)).toBe(1);
		expect(roundHalfEven(1200n, 1n)).toBe(1200);
		expect(roundHalfEven(0n, 7n)).toBe(0);
	});

	it("浮動小数点では0.5ちょうどにならない額も、正確に判定する", () => {
		// 0.1 + 0.2 のような誤差が出る額。2.675円 = 107/40 円は、近いほうの3円
		expect(roundHalfEven(107n, 40n)).toBe(3);
		// 1/3 を3回足すと、ちょうど1円
		expect(roundHalfEven(3n, 3n)).toBe(1);
	});

	it("マイナスや0の分母は受け付けない", () => {
		expect(() => roundHalfEven(-1n, 2n)).toThrowError(RangeError);
		expect(() => roundHalfEven(1n, 0n)).toThrowError(RangeError);
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

	it("割り勘は、払った人も含めた人数で割る", () => {
		expect(settle(warikan("1", ["2", "3"], 3000))).toEqual([
			{ fromId: "2", toId: "1", amount: 1000 },
			{ fromId: "3", toId: "1", amount: 1000 },
		]);
	});

	it("割り切れない分は、支払い1回ごとに偶数丸めする", () => {
		// 2と3の分は 3333.33… 円ずつ。1が受け取るのは 6,666円になり、合計はずれない
		expect(settle(warikan("1", ["2", "3"], 10000))).toEqual([
			{ fromId: "2", toId: "1", amount: 3333 },
			{ fromId: "3", toId: "1", amount: 3333 },
		]);
		// 1人分が500.5円なら500円、1,501.5円なら1,502円
		expect(settle(warikan("1", ["2"], 1001))).toEqual([
			{ fromId: "2", toId: "1", amount: 500 },
		]);
		expect(settle(warikan("1", ["2"], 3003))).toEqual([
			{ fromId: "2", toId: "1", amount: 1502 },
		]);
	});

	it("1円未満の端数は、切り捨てずに月の分を足してから丸める", () => {
		// 1回ごとに丸めると 333円 × 2 = 666円だが、足してから丸めると 2000/3 = 666.66… で667円
		expect(
			settle([
				...warikan("1", ["2", "3"], 1000),
				...warikan("1", ["2", "3"], 1000),
			]),
		).toEqual([
			{ fromId: "2", toId: "1", amount: 667 },
			{ fromId: "3", toId: "1", amount: 667 },
		]);
		// 500.5円と501.5円を足すと、ちょうど1,002円
		expect(
			settle([...warikan("1", ["2"], 1001), ...warikan("1", ["2"], 1003)]),
		).toEqual([{ fromId: "2", toId: "1", amount: 1002 }]);
	});

	it("割り勘とおごりの貸し借りも、まとめて差し引く", () => {
		// 2の分は 1000/3 円、2が1におごった300円を引くと、2が1に 100/3 円 ≒ 33円
		expect(
			settle([...warikan("1", ["2", "3"], 1000), treat("2", "1", 300)]),
		).toEqual([
			{ fromId: "3", toId: "1", amount: 333 },
			{ fromId: "2", toId: "1", amount: 33 },
		]);
	});

	it("丸めて0円になった支払いは載せない", () => {
		// 1円を3人で割ると、2と3の分は 1/3 円ずつ
		expect(settle(warikan("1", ["2", "3"], 1))).toEqual([]);
	});

	it("おごりだけの記録なら、支払うと全員の収支が0になり、回数は人数 - 1 回以下", () => {
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
			const rest = applyTransfers(balances, transfers);
			expect([...rest.values()].every((balance) => balance === 0n)).toBe(true);
			expect(transfers.length).toBeLessThanOrEqual(
				Math.max(0, balances.amounts.size - 1),
			);
		}
	});

	it("割り勘があっても、支払いは1円以上の整数で、残る差は支払い1回あたり0.5円以下", () => {
		const random = seededRandom(7);
		for (let round = 0; round < 200; round++) {
			const people = 2 + Math.floor(random() * 9);
			const entries: LedgerEntry[] = [];
			for (let i = 0; i < 1 + Math.floor(random() * 20); i++) {
				const payer = Math.floor(random() * people);
				const others = [...Array(people).keys()]
					.filter((p) => p !== payer && random() < 0.6)
					.map(String);
				const amount = 1 + Math.floor(random() * 10000);
				entries.push(
					...(others.length > 0
						? warikan(String(payer), others, amount)
						: [treat(String(payer), String((payer + 1) % people), amount)]),
				);
			}
			const balances = computeBalances(entries);
			const transfers = computeTransfers(balances);
			for (const transfer of transfers) {
				expect(Number.isSafeInteger(transfer.amount)).toBe(true);
				expect(transfer.amount).toBeGreaterThan(0);
			}
			expect(transfers.length).toBeLessThanOrEqual(
				Math.max(0, balances.amounts.size - 1),
			);
			const rest = applyTransfers(balances, transfers);
			for (const [id, amount] of rest) {
				const count = transfers.filter(
					(t) => t.fromId === id || t.toId === id,
				).length;
				// 残る差(の2倍) ≦ 支払いの回数 × 1円。0.5円ちょうどの丸めがあるので等号も入る
				const twice = (amount < 0n ? -amount : amount) * 2n;
				expect(twice <= BigInt(count) * balances.denominator).toBe(true);
			}
		}
	});
});

/** 支払いを済ませたあとに、人ごとに残る収支(分子)。全部0なら、ちょうど精算できた */
function applyTransfers(
	balances: Balances,
	transfers: readonly Transfer[],
): Map<string, bigint> {
	const rest = new Map(balances.amounts);
	for (const transfer of transfers) {
		const amount = BigInt(transfer.amount) * balances.denominator;
		rest.set(transfer.fromId, (rest.get(transfer.fromId) ?? 0n) + amount);
		rest.set(transfer.toId, (rest.get(transfer.toId) ?? 0n) - amount);
	}
	return rest;
}

/** 毎回同じ並びになる乱数(テストの結果を再現できるようにする) */
function seededRandom(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state * 1103515245 + 12345) % 2147483648;
		return state / 2147483648;
	};
}
