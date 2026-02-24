// Renderer entry point
import { initApp } from './ui/app'

async function main(): Promise<void> {
  const container = document.getElementById('app')!
  await initApp(container)
  console.log('AutoPuppet renderer loaded')
}

main().catch(console.error)

