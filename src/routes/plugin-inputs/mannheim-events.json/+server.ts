import { fetchMannheimEventOccurrences } from '$lib/server/plugins/sources/mannheim-events';
import { json } from '@sveltejs/kit';

let cached: {
	expiresAt: number;
	events: Awaited<ReturnType<typeof fetchMannheimEventOccurrences>>;
} | null = null;

export async function GET() {
	const now = new Date();
	if (!cached || cached.expiresAt <= now.getTime()) {
		cached = {
			expiresAt: now.getTime() + 30 * 60 * 1000,
			events: await fetchMannheimEventOccurrences(now)
		};
	}

	return json(
		{ events: cached.events },
		{ headers: { 'cache-control': 'public, max-age=300, stale-while-revalidate=1500' } }
	);
}
