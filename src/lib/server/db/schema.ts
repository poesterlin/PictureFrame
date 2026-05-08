import { boolean, integer, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

const fullCascade = { onDelete: 'cascade', onUpdate: 'cascade' } as const;

export const usersTable = pgTable('user', {
	id: text('id').primaryKey(),
	email: text('email'),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
	lastLogin: timestamp('last_login', { withTimezone: true, mode: 'date' }),
	username: text('username').notNull(),
	passwordHash: text('password_hash').notNull()
}, (table) => [
	uniqueIndex('user_username_unique').on(table.username),
	uniqueIndex('user_email_unique').on(table.email)
]);

export type User = typeof usersTable.$inferSelect;

export const sessionTable = pgTable('session', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull().references(() => usersTable.id, fullCascade),
	expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull()
});

export type Session = typeof sessionTable.$inferSelect;

export const pictures = pgTable('pictures', {
	id: serial('id').primaryKey(),
	frameId: integer('frame_id').notNull().references((): AnyPgColumn => pictureFrames.id, fullCascade),
	ownerUserId: text('owner_user_id').references(() => usersTable.id, {
		onDelete: 'set null',
		onUpdate: 'cascade'
	}),
	uploaderName: text('uploader_name').notNull(),
	fileName: text('file_name').notNull(),
	favorite: boolean('favorite').notNull().default(false),
	skipped: boolean('skipped').notNull().default(false),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull()
});

export type Picture = typeof pictures.$inferSelect;
export type NewPicture = typeof pictures.$inferInsert;

export const pictureFrames = pgTable('picture_frames', {
	id: serial('id').primaryKey(),
	ownerUserId: text('owner_user_id').references(() => usersTable.id, fullCascade),
	frameName: text('frame_name').notNull(),
	authKey: text('auth_key').notNull(),
	currentPictureId: integer('current_picture_id').references((): AnyPgColumn => pictures.id, {
		onDelete: 'set null',
		onUpdate: 'cascade'
	}),
	refreshEverySeconds: integer('refresh_every_seconds').notNull().default(3600),
	autoRotate: boolean('auto_rotate').notNull().default(true),
	showFavoritesOnly: boolean('show_favorites_only').notNull().default(false),
	disabled: boolean('disabled').notNull().default(false),
	lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull()
}, (table) => [
	uniqueIndex('picture_frames_auth_key_unique').on(table.authKey)
]);

export type PictureFrame = typeof pictureFrames.$inferSelect;
export type NewPictureFrame = typeof pictureFrames.$inferInsert;

export const publicUploadLinks = pgTable('public_upload_links', {
	id: serial('id').primaryKey(),
	frameId: integer('frame_id').notNull().references(() => pictureFrames.id, fullCascade),
	codeHash: text('code_hash').notNull(),
	expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
	maxUploads: integer('max_uploads').notNull().default(0),
	uploadCount: integer('upload_count').notNull().default(0),
	disabled: boolean('disabled').notNull().default(false),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull()
}, (table) => ({
	codeHashUnique: uniqueIndex('public_upload_links_code_hash_unique').on(table.codeHash)
}));

export type PublicUploadLink = typeof publicUploadLinks.$inferSelect;
export type NewPublicUploadLink = typeof publicUploadLinks.$inferInsert;

export const frameClaimCodes = pgTable('frame_claim_codes', {
	id: serial('id').primaryKey(),
	frameId: integer('frame_id').notNull().references(() => pictureFrames.id, fullCascade),
	codeHash: text('code_hash').notNull(),
	expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
	claimedByUserId: text('claimed_by_user_id').references(() => usersTable.id, {
		onDelete: 'set null',
		onUpdate: 'cascade'
	}),
	claimedAt: timestamp('claimed_at', { withTimezone: true, mode: 'date' }),
	disabled: boolean('disabled').notNull().default(false),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull()
}, (table) => ({
	codeHashUnique: uniqueIndex('frame_claim_codes_code_hash_unique').on(table.codeHash)
}));

export type FrameClaimCode = typeof frameClaimCodes.$inferSelect;
export type NewFrameClaimCode = typeof frameClaimCodes.$inferInsert;
