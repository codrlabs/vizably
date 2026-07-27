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

const FOLDER = {
  id: 'folder-1',
  name: 'Vizably scans',
  url: 'https://drive.google.com/drive/folders/folder-1',
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
    getAuthConfig: vi.fn().mockResolvedValue({
      googleClientId: '123456-abc.apps.googleusercontent.com',
      googlePickerApiKey: 'picker-key',
      googleCloudProjectNumber: '123456',
    }),
    getGoogleAccessToken: vi.fn().mockResolvedValue({ accessToken: 'ya29.token' }),
    ...overrides,
  }
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

  it('opens Google Picker and validates the chosen folder', async () => {
    const client = mockClient()
    const openFolderPicker = vi.fn().mockResolvedValue(FOLDER)

    render(
      <ConnectView
        provider="google"
        onDone={vi.fn()}
        onCancel={vi.fn()}
        client={client}
        openFolderPicker={openFolderPicker}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /choose folder in google drive/i }))

    await waitFor(() =>
      expect(openFolderPicker).toHaveBeenCalledWith({
        clientId: '123456-abc.apps.googleusercontent.com',
        accessToken: 'ya29.token',
        projectNumber: '123456',
      }),
    )
    await waitFor(() =>
      expect(client.validateStorage).toHaveBeenCalledWith('google', {
        id: FOLDER.id,
        name: FOLDER.name,
        url: FOLDER.url,
      }),
    )
    expect(screen.getByText(/Selected:/i)).toBeInTheDocument()
    expect(screen.getByText('Vizably account found')).toBeInTheDocument()
  })

  it('creates a new Google Drive folder via setupStorage init', async () => {
    const onDone = vi.fn()
    const client = mockClient()

    render(
      <ConnectView
        provider="google"
        onDone={onDone}
        onCancel={vi.fn()}
        client={client}
        openFolderPicker={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText(/Create a new folder/i))
    const input = screen.getByDisplayValue('Vizably')
    fireEvent.change(input, { target: { value: 'My Vizably' } })

    const button = screen.getByRole('button', { name: /create folder & continue/i })
    fireEvent.click(button)

    await waitFor(() =>
      expect(client.setupStorage).toHaveBeenCalledWith('google', { name: 'My Vizably' }, 'init'),
    )
    expect(onDone).toHaveBeenCalled()
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
})
