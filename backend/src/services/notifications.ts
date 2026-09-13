/**
 * Telling a person something happened, inside the app.
 *
 * One function every layer calls, in its own transaction, so a notification
 * exists exactly when the thing it reports does. The service knows nothing about
 * what is being reported: each caller writes its own sentence, because only the
 * layer that did something knows how to say it.
 *
 * In-app only (see the model). Nothing here sends anything anywhere.
 */
import type { Prisma, PrismaClient } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

export interface NotifyInput {
  userId: number
  kind: string
  title: string
  body: string
  href?: string | null
}

export async function notify(db: Db, input: NotifyInput): Promise<void> {
  await db.notification.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      title: input.title.slice(0, 200),
      body: input.body.slice(0, 1000),
      href: input.href ?? null,
    },
  })
}
