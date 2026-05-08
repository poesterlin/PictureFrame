import { env } from '$env/dynamic/private';

function parseCsv(value: string | undefined) {
	if (!value) return new Set<string>();
	return new Set(
		value
			.split(',')
			.map((item) => item.trim())
			.filter((item) => item.length > 0)
	);
}

export function isAdminUser(user: { id: string; username: string } | null) {
	if (!user) return false;

	const adminUserIds = parseCsv(env.ADMIN_USER_IDS);

	return adminUserIds.has(user.id);
}
