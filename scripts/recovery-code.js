#!/usr/bin/env node
/**
 * Mint a fresh recovery code for an account.
 *
 * Two reasons this exists. Accounts created before recovery codes did have
 * none, and since signups close after the first one, that is most likely *the*
 * account on any given deployment. And a code that has been lost has to be
 * replaceable by someone with access to the machine — which, for a thing that
 * runs in a house, is the only authority there is.
 *
 *   node scripts/recovery-code.js you@example.com
 *   docker compose exec noggin node scripts/recovery-code.js you@example.com
 *
 * Whatever code the account had stops working the moment this prints a new one.
 */
import { hashRecoveryCode, newRecoveryCode } from "../server/auth.js"
import { getStore, initStore } from "../server/store/index.js"

const email = process.argv[2]

if (!email) {
  console.error("usage: node scripts/recovery-code.js <email>")
  process.exit(1)
}

await initStore()
const store = getStore()

const user = await store.findUserByEmail(email)
if (!user) {
  console.error(`No account for ${email}.`)
  await store.close()
  process.exit(1)
}

const code = newRecoveryCode()
await store.updateUser(user.id, { recoveryHash: await hashRecoveryCode(code) })
await store.close()

console.log(`
  Recovery code for ${user.email}

      ${code}

  Write it down. It is stored only as a hash, so this is the one time it can
  be read — running this again replaces it.

  To use it: open the sign-in page, choose "Forgotten your password?", and
  enter this code with the new password you want.
`)
