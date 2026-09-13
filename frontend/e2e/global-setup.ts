import { execSync } from 'node:child_process'
import path from 'node:path'

/**
 * Sessions, fresh photographs and ids, written by the backend before any test
 * runs — see backend/scripts/e2e-setup.ts for why each is made this way.
 */
export default function globalSetup() {
    execSync('npm run e2e:setup', {
        cwd: path.resolve(__dirname, '..', '..', 'backend'),
        stdio: 'inherit',
    })
}
