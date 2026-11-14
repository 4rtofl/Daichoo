import { describe, expect, it } from "vitest";
import { LedgerFormatError } from "../src/ledger/entries.ts";
import {
	parseSettings,
	updateSettlementChannel,
} from "../src/ledger/settings.ts";

describe("updateSettlementChannel", () => {
	it("設定がなければ作る", () => {
		const text = updateSettlementChannel(null, { id: "123", name: "精算" });
		expect(text).toBe(
			'{\n\t"settlementChannel": {\n\t\t"id": "123",\n\t\t"name": "精算"\n\t}\n}\n',
		);
		expect(parseSettings(text ?? "")).toEqual({
			settlementChannel: { id: "123", name: "精算" },
		});
	});

	it("ほかの項目は残し、送り先だけを置き換える", () => {
		const current = JSON.stringify({
			memo: "手で書いた",
			settlementChannel: { id: "1", name: "old" },
		});
		const next = JSON.parse(
			updateSettlementChannel(current, { id: "2", name: "new" }) ?? "",
		);
		expect(next).toEqual({
			memo: "手で書いた",
			settlementChannel: { id: "2", name: "new" },
		});
	});

	it("中身が変わらなければnullを返す", () => {
		const text = updateSettlementChannel(null, { id: "123", name: "精算" });
		expect(updateSettlementChannel(text, { id: "123", name: "精算" })).toBe(
			null,
		);
	});

	it("JSONとして読めない設定は、消さずにエラーにする", () => {
		expect(() =>
			updateSettlementChannel("{ broken", { id: "1", name: "a" }),
		).toThrowError(LedgerFormatError);
	});
});

describe("parseSettings", () => {
	it("送り先がなければ空の設定", () => {
		expect(parseSettings("{}")).toEqual({});
	});

	it("チャンネルのIDが正しくなければエラーにする", () => {
		expect(() =>
			parseSettings('{"settlementChannel":{"id":"abc"}}'),
		).toThrowError(LedgerFormatError);
	});
});
