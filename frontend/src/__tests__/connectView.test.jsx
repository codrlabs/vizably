import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ConnectView from '../views/ConnectView'

const REPO = {
  id: 'R_kg',
  name: 'site-audits',
  full_name: 'sam/site-audits',
  private: true,
  html_url: 'https://github.com/sam/site-audits',
}

function mockClient(overrides = {}) {
  return {
    listStorages: vi.fn().mockResolvedValue({ provider: 'github', storages: [REPO] }),
    validateStorage: vi.fn().mockResolvedValue({
      status: 'loadable',
      reason: null,
      capabilities: { canRead: true, canWrite: true, canCreate: false },
      manifestSummary: { scanCount: 3, schemaVersion: 1, accountId: 'a1' },
    }),
    setupStorage: vi.fn().mockResolvedValue({ success: true }),
    checkRepoNameAvailability: vi.fn().mockImplementation(async (name) => ({
      provider: 'github',
      name,
      normalizedName: name.trim(),
      full_name: `sam/${name.trim()}`,
      status: 'available',
      message: `sam/${name.trim()} is available.`,
    })),
    createStorage: vi.fn().mockResolvedValue({
      provider: 'github',
      storageRef: {
        id: 'R_kgNew',
        name: 'vizably-new',
        full_name: 'sam/vizably-new',
        private: true,
        html_url: 'https://github.com/sam/vizably-new',
      },
      needsInstall: false,
      installUrl: null,
    }),
    ...overrides,
  }
}

async function typeNewRepoName(value) {
  fireEvent.click(screen.getByText(/Create a new repository/i))
  const input = screen.getByDisplayValue('vizably-scans')
  fireEvent.change(input, { target: { value } })
  return input
}

async function waitForRepoPicker(client) {
  await screen.findByText('sam/site-audits (private)', {}, { timeout: 3000 })
  await waitFor(() => expect(client.listStorages).toHaveBeenCalledWith('github'))
  await waitFor(() => expect(client.validateStorage).toHaveBeenCalled())
}

describe('ConnectView', () => {
  beforeEach(() => {
    vi.stubGlobal('location', { href: 'http://localhost:5173/connect' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads GitHub repos and validates the selected repo', async () => {
    const client = mockClient()
    render(
      <ConnectView
        provider="github"
        onDone={vi.fn()}
        onCancel={vi.fn()}
        client={client}
      />,
    )

    await waitForRepoPicker(client)
    expect(client.validateStorage).toHaveBeenCalledWith('github', {
      id: REPO.id,
      full_name: REPO.full_name,
      html_url: REPO.html_url,
    })
    expect(screen.getByText('Vizably account found')).toBeInTheDocument()
    expect(screen.getByText('3 saved scans')).toBeInTheDocument()
  })

  it('calls setupStorage with load on confirm for loadable storage', async () => {
    const onDone = vi.fn()
    const client = mockClient()
    render(
      <ConnectView provider="github" onDone={onDone} onCancel={vi.fn()} client={client} />,
    )

    await waitForRepoPicker(client)
    expect(await screen.findByText('Vizably account found')).toBeInTheDocument()

    const button = screen.getByRole('button', { name: /load my account/i })
    fireEvent.click(button)

    await waitFor(() =>
      expect(client.setupStorage).toHaveBeenCalledWith(
        'github',
        expect.objectContaining({ id: REPO.id, full_name: REPO.full_name }),
        'load',
      ),
    )
    expect(onDone).toHaveBeenCalled()
  })

  it('offers set up & continue for initializable storage', async () => {
    const client = mockClient({
      validateStorage: vi.fn().mockResolvedValue({
        status: 'initializable',
        capabilities: { canRead: true, canWrite: true, canCreate: true },
      }),
    })

    render(
      <ConnectView provider="github" onDone={vi.fn()} onCancel={vi.fn()} client={client} />,
    )

    await waitForRepoPicker(client)
    expect(await screen.findByText('Ready to set up')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /set up & continue/i }),
    ).toBeInTheDocument()
  })

  it('blocks init when storage is not writable', async () => {
    const client = mockClient({
      validateStorage: vi.fn().mockResolvedValue({
        status: 'initializable',
        capabilities: { canRead: true, canWrite: false, canCreate: false },
      }),
    })

    render(
      <ConnectView provider="github" onDone={vi.fn()} onCancel={vi.fn()} client={client} />,
    )

    await waitForRepoPicker(client)
    expect(await screen.findByText('Ready to set up')).toBeInTheDocument()

    const button = screen.getByRole('button', { name: /set up & continue/i })
    expect(button).toBeDisabled()
    expect(screen.getByText(/read-only/i)).toBeInTheDocument()
  })

  it('blocks incompatible storage', async () => {
    const client = mockClient({
      validateStorage: vi.fn().mockResolvedValue({
        status: 'incompatible',
        reason: 'too_new',
        capabilities: { canRead: true, canWrite: true, canCreate: false },
      }),
    })

    render(
      <ConnectView provider="github" onDone={vi.fn()} onCancel={vi.fn()} client={client} />,
    )

    await waitForRepoPicker(client)
    expect(await screen.findByText('Update Vizably required')).toBeInTheDocument()

    const button = screen.getByRole('button', { name: /continue/i })
    expect(button).toBeDisabled()
  })

  it('shows Google deferred message for google provider', () => {
    render(
      <ConnectView provider="google" onDone={vi.fn()} onCancel={vi.fn()} client={mockClient()} />,
    )

    expect(screen.getByText(/Phase 3/i)).toBeInTheDocument()
    expect(screen.queryByText(/load my account/i)).not.toBeInTheDocument()
  })

  it('renders storageError prop', async () => {
    const client = mockClient({ listStorages: vi.fn().mockRejectedValue(new Error('nope')) })
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
  })

  it('creates a new repository then validates for init', async () => {
    const created = {
      id: 'R_kgNew',
      name: 'vizably-new',
      full_name: 'sam/vizably-new',
      private: true,
      html_url: 'https://github.com/sam/vizably-new',
    }
    const client = mockClient({
      createStorage: vi.fn().mockResolvedValue({
        provider: 'github',
        storageRef: created,
        needsInstall: false,
        installUrl: null,
      }),
      validateStorage: vi.fn().mockResolvedValue({
        status: 'initializable',
        capabilities: { canRead: true, canWrite: true, canCreate: true },
      }),
    })

    render(
      <ConnectView provider="github" onDone={vi.fn()} onCancel={vi.fn()} client={client} />,
    )

    await waitForRepoPicker(client)

    await typeNewRepoName('vizably-new')
    expect(await screen.findByText(/is available/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /create repository/i }))

    await waitFor(() => expect(client.createStorage).toHaveBeenCalledWith('vizably-new'))
    await waitFor(() =>
      expect(client.validateStorage).toHaveBeenCalledWith(
        'github',
        expect.objectContaining({ id: 'R_kgNew', full_name: 'sam/vizably-new' }),
      ),
    )
    expect(await screen.findByText('Ready to set up')).toBeInTheDocument()
  })

  it('shows probe failure message without install CTA', async () => {
    const err = new Error(
      'GitHub rate-limited the request while checking App installation access. Wait a moment and refresh — do not reinstall the Vizably GitHub App.',
    )
    err.code = 'GITHUB_RATE_LIMITED'
    err.storageRef = {
      id: 'R_kgNew',
      name: 'vizably-new',
      full_name: 'sam/vizably-new',
      private: true,
      html_url: 'https://github.com/sam/vizably-new',
    }
    const client = mockClient({
      createStorage: vi.fn().mockRejectedValue(err),
    })

    render(
      <ConnectView provider="github" onDone={vi.fn()} onCancel={vi.fn()} client={client} />,
    )

    await waitForRepoPicker(client)
    fireEvent.click(screen.getByText(/Create a new repository/i))
    fireEvent.change(screen.getByDisplayValue('vizably-scans'), {
      target: { value: 'vizably-new' },
    })
    // Availability must resolve so Create is enabled.
    expect(await screen.findByText(/is available/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /create repository/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not reinstall/i)
    expect(screen.queryByText(/Open GitHub App install/i)).not.toBeInTheDocument()
  })

  it('normalizes whitespace in the repository name before create', async () => {
    const client = mockClient({
      createStorage: vi.fn().mockResolvedValue({
        provider: 'github',
        storageRef: {
          id: 'R_kgNew',
          name: 'vizably-new',
          full_name: 'sam/vizably-new',
          private: true,
          html_url: 'https://github.com/sam/vizably-new',
        },
        needsInstall: false,
        installUrl: null,
      }),
      validateStorage: vi.fn().mockResolvedValue({
        status: 'initializable',
        capabilities: { canRead: true, canWrite: true, canCreate: true },
      }),
      checkRepoNameAvailability: vi.fn().mockResolvedValue({
        provider: 'github',
        name: 'vizably-new',
        normalizedName: 'vizably-new',
        full_name: 'sam/vizably-new',
        status: 'available',
        message: 'sam/vizably-new is available.',
      }),
    })

    render(
      <ConnectView provider="github" onDone={vi.fn()} onCancel={vi.fn()} client={client} />,
    )

    await waitForRepoPicker(client)
    fireEvent.click(screen.getByText(/Create a new repository/i))
    fireEvent.change(screen.getByDisplayValue('vizably-scans'), {
      target: { value: '  vizably   new  ' },
    })
    expect(await screen.findByText(/is available/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /create repository/i }))

    await waitFor(() => expect(client.createStorage).toHaveBeenCalledWith('vizably-new'))
    expect(screen.getByDisplayValue('vizably-new')).toBeInTheDocument()
  })

  it('keeps focus on the repository name input while typing', async () => {
    const client = mockClient()
    render(
      <ConnectView provider="github" onDone={vi.fn()} onCancel={vi.fn()} client={client} />,
    )

    await waitForRepoPicker(client)
    fireEvent.click(screen.getByText(/Create a new repository/i))

    const input = screen.getByDisplayValue('vizably-scans')
    input.focus()
    expect(document.activeElement).toBe(input)

    fireEvent.change(input, { target: { value: 'v' } })
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { value: 'vi' } })
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { value: 'viz' } })
    expect(document.activeElement).toBe(input)
    expect(input).toHaveValue('viz')
  })

  it('shows taken status and blocks create for an existing name', async () => {
    const client = mockClient({
      // Name is taken on GitHub but not in the local picker list.
      checkRepoNameAvailability: vi.fn().mockResolvedValue({
        provider: 'github',
        name: 'already-taken',
        normalizedName: 'already-taken',
        full_name: 'sam/already-taken',
        status: 'taken',
        message: 'A repository named "already-taken" already exists on your account.',
      }),
    })

    render(
      <ConnectView provider="github" onDone={vi.fn()} onCancel={vi.fn()} client={client} />,
    )

    await waitForRepoPicker(client)
    await typeNewRepoName('already-taken')

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create repository/i })).toBeDisabled()
    expect(client.createStorage).not.toHaveBeenCalled()
  })

  it('shows install hop when create returns needsInstall', async () => {
    const client = mockClient({
      createStorage: vi.fn().mockResolvedValue({
        provider: 'github',
        storageRef: {
          id: 'R_kgNew',
          name: 'vizably-new',
          full_name: 'sam/vizably-new',
          private: true,
          html_url: 'https://github.com/sam/vizably-new',
        },
        needsInstall: true,
        installUrl: 'https://github.com/apps/vizably/installations/new',
      }),
    })

    render(
      <ConnectView provider="github" onDone={vi.fn()} onCancel={vi.fn()} client={client} />,
    )

    await waitForRepoPicker(client)
    await typeNewRepoName('vizably-new')
    expect(await screen.findByText(/is available/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /create repository/i }))

    expect(await screen.findByText(/Open GitHub App install/i)).toHaveAttribute(
      'href',
      'https://github.com/apps/vizably/installations/new',
    )
    expect(screen.getByText(/I've added it — refresh/i)).toBeInTheDocument()
  })
})
