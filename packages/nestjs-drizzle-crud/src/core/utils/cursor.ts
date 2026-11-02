import { BadRequestException } from "@nestjs/common";

// A keyset cursor is the sort values of the last row on a page, primary key
// last, plus the sort it was made for. It is base64url JSON: opaque to the
// client, but not secret, so never put anything in it a row does not already
// show. A bigint does not survive JSON, so it travels as { $b: "123" }.

interface CursorBody {
	s: string;
	v: unknown[];
}

export function encodeCursor(values: unknown[], signature: string): string {
	const body: CursorBody = {
		s: signature,
		v: values.map((value) =>
			typeof value === "bigint" ? { $b: value.toString() } : value,
		),
	};
	return Buffer.from(JSON.stringify(body)).toString("base64url");
}

// The values of a cursor, or a 400 when it is not one of ours, was made for a
// different sort, or has the wrong number of values.
export function decodeCursor(
	cursor: string,
	signature: string,
	length: number,
): unknown[] {
	let body: CursorBody;
	try {
		body = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
	} catch {
		throw new BadRequestException("Invalid cursor");
	}
	if (
		!body ||
		typeof body !== "object" ||
		!Array.isArray(body.v) ||
		body.v.length !== length
	) {
		throw new BadRequestException("Invalid cursor");
	}
	if (body.s !== signature) {
		throw new BadRequestException(
			"The cursor was made for a different sort; start again without one",
		);
	}
	return body.v.map((value: any) => {
		if (!value || typeof value !== "object") return value;
		if (typeof value.$b !== "string") {
			throw new BadRequestException("Invalid cursor");
		}
		try {
			return BigInt(value.$b);
		} catch {
			throw new BadRequestException("Invalid cursor");
		}
	});
}
