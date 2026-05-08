import postgres from 'postgres';

export type AuthenticatedFrame = {
	frameId: number;
	ownerUserId: string | null;
};

let _sql: ReturnType<typeof postgres> | null = null;

function getSql() {
	if (!_sql) {
		if (!process.env.DATABASE_URL) {
			return null;
		}
		_sql = postgres(process.env.DATABASE_URL, {
			max: 1,
			idle_timeout: 5
		});
	}
	return _sql;
}

function readBearerToken(headers: Headers): string | null {
	const authorization = headers.get('authorization')?.trim() ?? '';
	if (!authorization.toLowerCase().startsWith('bearer ')) {
		return null;
	}
	const token = authorization.slice('bearer '.length).trim();
	return token.length > 0 ? token : null;
}

export function getBearerToken(headers: Headers): string | null {
	return readBearerToken(headers);
}

export async function authenticateFrameToken(token: string): Promise<AuthenticatedFrame | null> {
	if (!process.env.DATABASE_URL) {
		return null;
	}

	const sql = getSql();
	if (!sql) {
		return null;
	}

	const frame = await sql<{ frameId: number; ownerUserId: string | null }[]>`
		select id as "frameId", owner_user_id as "ownerUserId"
		from picture_frames
		where auth_key = ${token}
		limit 1
	`;

	if (frame.length === 0) {
		return null;
	}

	return frame[0];
}

export async function authenticateFrameRequest(headers: Headers): Promise<AuthenticatedFrame | null> {
	const token = readBearerToken(headers);
	if (!token) {
		return null;
	}
	return authenticateFrameToken(token);
}

export function unauthorizedHttpResponse(): Response {
	return new Response('Unauthorized', {
		status: 401,
		headers: {
			'www-authenticate': 'Bearer'
		}
	});
}

export async function authenticateFrameWsRequest(request: Request): Promise<AuthenticatedFrame | null> {
	const bearer = readBearerToken(request.headers);
	if (bearer) {
		return authenticateFrameToken(bearer);
	}

	const tokenFromQuery = new URL(request.url).searchParams.get('token')?.trim();
	if (!tokenFromQuery) {
		return null;
	}

	return authenticateFrameToken(tokenFromQuery);
}
