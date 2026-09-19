import { watch } from '../../scripts/watch.mjs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = dirname(fileURLToPath(import.meta.url))

watch(packageDir)
