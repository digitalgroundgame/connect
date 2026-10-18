import { relations } from 'drizzle-orm'
import { boolean, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth-schema'

export * from './auth-schema'

/** A tool members can get a code for, added by an admin. Hindsight is the first. */
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Stable short name, shown in codes' admin views and used in URLs. */
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  /** Where members download or read about the tool. */
  homepageUrl: text('homepage_url'),
  /** Whether codes for this project may DM their member through the Digital Ground Game bot. */
  canDm: boolean('can_dm').notNull().default(false),
  /** A disabled project hides from members and its codes stop working. */
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

/**
 * One code per member per project. Getting a new code replaces the old one,
 * so a leaked code is fixed by getting another.
 */
export const accessCodes = pgTable(
  'access_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** SHA-256 of the code, hex. The code itself is shown once and never stored. */
    codeHash: text('code_hash').notNull().unique(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    unique('access_codes_user_project_unique').on(table.userId, table.projectId),
    index('access_codes_project_idx').on(table.projectId),
  ],
)

export const projectRelations = relations(projects, ({ many }) => ({
  codes: many(accessCodes),
}))

export const accessCodeRelations = relations(accessCodes, ({ one }) => ({
  user: one(user, { fields: [accessCodes.userId], references: [user.id] }),
  project: one(projects, { fields: [accessCodes.projectId], references: [projects.id] }),
}))
