export async function activate(context) {
  context.logger.info('Nocturne theme sample activated')
  await context.twilight.themes.register({
    id: 'nocturne',
    name: 'Nocturne',
    description: 'A declarative Phase 3 theme sample.',
    variables: {
      '--te-primary-500': '#38bdf8',
      '--te-neutral-900': '#dbeafe',
      '--te-neutral-700': '#bfdbfe',
      '--te-neutral-500': '#7dd3fc'
    },
    stylesheet: 'theme.css'
  })
}

export function deactivate() {}
