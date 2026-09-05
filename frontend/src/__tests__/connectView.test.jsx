import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ConnectView from '../views/ConnectView'

const LOADABLE = {
  status: 'loadable',
  reason: null,
  capabilities: { canRead: true, canWrite: true, canCreate: false },
  manifestSummary: { scanCount: 3, schemaVersion: 1, accountId: 'a1' },
}

const STORE = {
  storageRef: {
    id: 'R_kg',
    name: 'vizably-scans',
    full_name: 'sam/vizably-scans',
    html_url: 'https://github.com/sam/vizably-scans',
  },
  validation: LOADABLE,
}

function mockClient(overrides = {}) {
  return {
    discoverStorages: vi.fn().mockResolvedValue({
      provider: 'github',
      stores: [STORE],
      source: 'list',
    }),
    validateStorage: vi.fn().mockResolvedValue(LOADABLE),
    setupStorage: vi.fn().mockResolvedValue({ success: true }),
    createStorage: vi.fn().mockResolvedValue({
      provider: 'github',
      storageRef: {
        id: 'R_kgNew',
        name: 'viz_scans',
        full_name: 'sam/viz_scans',
        private: true,
        html_url: 'https://github.com/sam/viz_scans',
      },
      needsInstall: false,
      installUrl: null,
    }),
    ...overrides,
  }
}

describe('ConnectView', () => {
  beforeEach(() => {
    vi.stubGlobal('location', { href: 'http://localhost:5173/connect' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('discovers a store and offers load without a name field or repo picker', async () => {
    const client = mockClient()
    render(
      <ConnectView provider="github" onDone={vi.fn()} onCancel={vi.fn()} client={client} />,
    )

    await waitFor(() => expect(client.discoverStorages).toHaveBeenCalledWith('github'))
    expect(await screen.findByText('Vizably account found')).toBeInTheDocument()
    expect(screen.getByText('3 saved scans')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('scans')).not.toBeInTheDocument()
    expect(screen.queryByText(/Use an existing/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /load my account/i })).toBeInTheDocument()
  })

  it('calls setupStorage with load on confirm', async () => {
    const onDone = vi.fn()
    const client = mockClient()
    render(
      <ConnectView provider="github" onDone={onDone} onCancel={vi.fn()} client={client} />,
    )

    expect(await screen.findByText('Vizably account found')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /load my account/i }))

    await waitFor(() =>
      expect(client.setupStorage).toHaveBeenCalledWith(
        'github',
        expect.objectContaining({ id: STORE.storageRef.id, full_name: STORE.storageRef.full_name }),
        'load',
      ),
    )
    expect(onDone).toHaveBeenCalled()
  })

  it('creates viz_scans and inits when no store exists', async () => {
    const onDone = vi.fn()
    const client = mockClient({
      discoverStorages: vi.fn().mockResolvedValue({
        provider: 'github',
        stores: [],
        source: 'list',
      }),
    })

    render(
      <ConnectView provider="github" onDone={onDone} onCancel={vi.fn()} client={client} />,
    )

    expect(await screen.findByRole('button', { name: /set up vizably storage/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /set up vizably storage/i }))

    await waitFor(() => expect(client.createStorage).toHaveBeenCalledWith())
    await waitFor(() =>
      expect(client.setupStorage).toHaveBeenCalledWith(
        'github',
        expect.objectContaining({ id: 'R_kgNew', full_name: 'sam/viz_scans' }),
        'init',
      ),
    )
    expect(onDone).toHaveBeenCalled()
  })

  it('shows a chooser only when two stores are discovered', async () => {
    const second = {
      storageRef: {
        id: 'R_two',
        name: 'viz_scans',
        full_name: 'sam/viz_scans',
        html_url: 'https://github.com/sam/viz_scans',
      },
      validation: {
        ...LOADABLE,
        manifestSummary: { scanCount: 1, schemaVersion: 1, accountId: 'a2' },
      },
    }
    const client = mockClient({
      discoverStorages: vi.fn().mockResolvedValue({
        provider: 'github',
        stores: [STORE, second],
        source: 'list',
      }),
    })

    render(
      <ConnectView provider="github" onDone={vi.fn()} onCancel={vi.fn()} client={client} />,
    )

    expect(await screen.findByLabelText(/choose vizably storage/i)).toBeInTheDocument()
    expect(screen.getByText(/more than one vizably store/i)).toBeInTheDocument()
  })

  it('blocks init when storage is not writable', async () => {
    const client = mockClient({
      discoverStorages: vi.fn().mockResolvedValue({
        provider: 'github',
        stores: [
          {
            storageRef: STORE.storageRef,
            validation: {
              status: 'initializable',
              capabilities: { canRead: true, canWrite: false, canCreate: false },
            },
          },
        ],
        source: 'list',
      }),
    })

    render(
      <ConnectView provider="github" onDone={vi.fn()} onCancel={vi.fn()} client={client} />,
    )

    expect(await screen.findByText('Ready to set up')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /set up & continue/i })).toBeDisabled()
    expect(screen.getByText(/read-only/i)).toBeInTheDocument()
  })

  it('shows Google deferred message for google provider', () => {
    render(
      <ConnectView provider="google" onDone={vi.fn()} onCancel={vi.fn()} client={mockClient()} />,
    )

    expect(screen.getByText(/Phase 3/i)).toBeInTheDocument()
    expect(screen.queryByText(/load my account/i)).not.toBeInTheDocument()
  })

  it('renders storageError prop', async () => {
    const client = mockClient()
    render(
      <ConnectView
        provider="github"
        onDone={vi.fn()}
        onCancel={vi.fn()}
        storageError="GitHub sign-in failed. Try again."
        client={client}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('GitHub sign-in failed')
    await waitFor(() => expect(client.discoverStorages).toHaveBeenCalled())
  })

  it('shows install hop when create returns needsInstall', async () => {
    const client = mockClient({
      discoverStorages: vi.fn().mockResolvedValue({
        provider: 'github',
        stores: [],
        source: 'list',
      }),
      createStorage: vi.fn().mockResolvedValue({
        provider: 'github',
        storageRef: {
          id: 'R_kgNew',
          name: 'viz_scans',
          full_name: 'sam/viz_scans',
          private: true,
          html_url: 'https://github.com/sam/viz_scans',
        },
        needsInstall: true,
        installUrl: 'https://github.com/apps/vizably/installations/new',
      }),
    })

    render(
      <ConnectView provider="github" onDone={vi.fn()} onCancel={vi.fn()} client={client} />,
    )

    fireEvent.click(await screen.findByRole('button', { name: /set up vizably storage/i }))

    expect(await screen.findByText(/Open GitHub App install/i)).toHaveAttribute(
      'href',
      'https://github.com/apps/vizably/installations/new',
    )
    expect(screen.getByText(/I've added it — refresh/i)).toBeInTheDocument()
    expect(client.createStorage).toHaveBeenCalledWith()
  })
})
