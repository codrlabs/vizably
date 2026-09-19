/**
 * ScanController — owns request/response for the scan endpoints.
 *
 * Today it delegates to the mock fixture; in Phase 2 the constructor
 * will accept a `runner` (`ScanRunner`) and call `runner.run(url)`.
 *
 * Methods are bound in the constructor so they can be passed directly
 * to `app.post('/api/scan', ctrl.postScan)` without losing `this`.
 * See docs/guides/axecore-integration.md for the bug pattern this
 * sidesteps.
 */
class ScanController {
  /**
   * @param {object} deps
   * @param {object} deps.mockScanResults  Phase-1 fixture; replaced in Phase 2
   * @param {{ validate: (s: string) => { ok: boolean, reason?: string } }} [deps.ssrfGuard]
   * @param {object} deps.scanRunner
   * @param {import('../services/authService')} [deps.authService]
   * @param {import('../services/storageService')} [deps.storageService]
   */
  constructor({ mockScanResults, ssrfGuard, scanRunner, authService, storageService }) {
    this.mockScanResults = mockScanResults;
    this.ssrfGuard = ssrfGuard;
    this.scanRunner = scanRunner;
    this.authService = authService;
    this.storageService = storageService;

    // Bind handlers once so router wiring stays clean.
    this.postScan = this.postScan.bind(this);
    this.getScanResults = this.getScanResults.bind(this);
    this.getSavedScan = this.getSavedScan.bind(this);
    this.getSavedScans = this.getSavedScans.bind(this);
    this.deleteSavedScan = this.deleteSavedScan.bind(this);
    this.deleteAllSavedScans = this.deleteAllSavedScans.bind(this);
    this.getProblem = this.getProblem.bind(this);
  }

  /**
   * POST /api/scan
   * Body: { url: string }
   */
   async postScan(req, res) {
     const { url } = req.body || {};
     if (this.ssrfGuard) {
       const guard = this.ssrfGuard.validate(url);
       if (!guard.ok) {
         return res.status(400).json({ error: guard.reason });
       }
     }
     console.log(`Received scan request for URL: ${url}`);
     try {
       const result = await this.scanRunner.run(url);

       if (
         this.authService &&
         this.storageService &&
         typeof req.isAuthenticated === 'function' &&
         req.isAuthenticated() &&
         req.user?.storage
       ) {
         let accountUpdate = null;
         try {
           const clients = await this.authService.clientsFor(req.user, {
             storageRef: req.user.storage,
           });
           const saved = await this.storageService.saveScanResults(
             req.user,
             result,
             url,
             clients,
           );
           if (saved?.scans) {
             // The scan list itself is deliberately not kept on the session —
             // it grows without bound and the session has to fit in a cookie.
             // `index.json` in the user's store is the source of truth; the
             // client refetches it from GET /api/scans.
             if (!req.user.account) {
               req.user.account = {
                 settings: { autoDelete90d: true },
                 scanCount: 0,
               };
             }
             req.user.account.scanCount = saved.scanCount;
             await this.authService.persistUser(req);
             accountUpdate = {
               scanCount: saved.scanCount,
               scans: saved.scans,
             };
           }
         } catch (storageErr) {
           console.warn(
             'Failed to save scan results to storage:',
             storageErr.message,
           );
         }

         if (accountUpdate) {
           return res.json({ ...result, account: accountUpdate });
         }
       }

       return res.json(result);
     } catch (err) {
       console.error(err);
       return res.status(500).json({ error: 'Internal server error' });
     }
   }

   /**
    * GET /api/scan-results?url=...
    */
   async getScanResults(req, res) {
     const { url } = req.query;
     if (!url) {
       return res.status(400).json({ error: 'Missing required ?url=' });
     }
     if (this.ssrfGuard) {
       const guard = this.ssrfGuard.validate(url);
       if (!guard.ok) {
         return res.status(400).json({ error: guard.reason });
       }
     }
     console.log(`Received request for scan results of URL: ${url}`);
     try {
       const result = await this.scanRunner.getResults(url);
       if (result === null) {
         return res.status(404).json({ error: 'No scan results found for URL' });
       }
       return res.json(result);
     } catch (err) {
       console.error(err);
       return res.status(500).json({ error: 'Internal server error' });
     }
   }

  /**
   * GET /api/scans/:id — load a saved historical report from attached storage.
   */
  async getSavedScan(req, res) {
    if (
      typeof req.isAuthenticated !== 'function' ||
      !req.isAuthenticated() ||
      !req.user?.storage
    ) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!this.authService || !this.storageService) {
      return res.status(503).json({ error: 'Storage is not configured' });
    }

    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'Missing scan id' });
    }

    try {
      const clients = await this.authService.clientsFor(req.user, {
        storageRef: req.user.storage,
      });
      const scan = await this.storageService.getScanById(req.user, id, clients);
      return res.json(scan);
    } catch (err) {
      if (err.code === 'SCAN_NOT_FOUND' || err.status === 404) {
        return res.status(404).json({ error: 'Scan not found' });
      }
      if (
        err.code === 'STORAGE_ACCESS_DENIED' ||
        err.code === 'STORAGE_IDENTITY_MISMATCH' ||
        err.status === 403
      ) {
        return res.status(403).json({ error: err.message });
      }
      console.error(err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * DELETE /api/scans — remove every saved report from attached storage.
   * Keeps the account manifest and repository; only clears scan files + caches.
   */
  async deleteAllSavedScans(req, res) {
    if (
      typeof req.isAuthenticated !== 'function' ||
      !req.isAuthenticated() ||
      !req.user?.storage
    ) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!this.authService || !this.storageService) {
      return res.status(503).json({ error: 'Storage is not configured' });
    }

    try {
      const clients = await this.authService.clientsFor(req.user, {
        storageRef: req.user.storage,
      });
      const result = await this.storageService.deleteAllScans(req.user, clients);

      if (!req.user.account) {
        req.user.account = {
          settings: { autoDelete90d: true },
          scanCount: 0,
        };
      }
      req.user.account.scanCount = result.scanCount;
      await this.authService.persistUser(req);

      return res.json({
        deletedCount: result.deletedCount,
        scanCount: result.scanCount,
        scans: result.scans,
      });
    } catch (err) {
      if (err.code === 'PROVIDER_NOT_AVAILABLE' || err.status === 501) {
        return res.status(501).json({
          error: err.message,
          code: err.code,
        });
      }
      if (
        err.code === 'STORAGE_ACCESS_DENIED' ||
        err.code === 'STORAGE_IDENTITY_MISMATCH' ||
        err.status === 403
      ) {
        return res.status(403).json({ error: err.message });
      }
      console.error(err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * DELETE /api/scans/:id — remove one saved report from attached storage.
   */
  async deleteSavedScan(req, res) {
    if (
      typeof req.isAuthenticated !== 'function' ||
      !req.isAuthenticated() ||
      !req.user?.storage
    ) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!this.authService || !this.storageService) {
      return res.status(503).json({ error: 'Storage is not configured' });
    }

    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'Missing scan id' });
    }

    try {
      const clients = await this.authService.clientsFor(req.user, {
        storageRef: req.user.storage,
      });
      const result = await this.storageService.deleteScanById(
        req.user,
        id,
        clients,
      );

      if (!req.user.account) {
        req.user.account = {
          settings: { autoDelete90d: true },
          scanCount: 0,
        };
      }
      req.user.account.scanCount = result.scanCount;
      await this.authService.persistUser(req);

      return res.json({
        scanCount: result.scanCount,
        scans: result.scans,
      });
    } catch (err) {
      if (err.code === 'SCAN_NOT_FOUND' || err.status === 404) {
        return res.status(404).json({ error: 'Scan not found' });
      }
      if (err.code === 'PROVIDER_NOT_AVAILABLE' || err.status === 501) {
        return res.status(501).json({
          error: err.message,
          code: err.code,
        });
      }
      if (
        err.code === 'STORAGE_ACCESS_DENIED' ||
        err.code === 'STORAGE_IDENTITY_MISMATCH' ||
        err.status === 403
      ) {
        return res.status(403).json({ error: err.message });
      }
      console.error(err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * GET /api/scans — list the saved scans held in the user's own storage.
   *
   * The list lives in `index.json` in the user's repo, not on the session:
   * it grows with every scan and the session must fit inside a 4KB cookie.
   */
  async getSavedScans(req, res) {
    if (
      typeof req.isAuthenticated !== 'function' ||
      !req.isAuthenticated() ||
      !req.user?.storage
    ) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!this.authService || !this.storageService) {
      return res.status(503).json({ error: 'Storage is not configured' });
    }

    try {
      const clients = await this.authService.clientsFor(req.user, {
        storageRef: req.user.storage,
      });
      const account = await this.storageService.loadAccount(
        req.user.storage.provider || 'github',
        req.user.storage,
        clients,
      );
      return res.json({
        scanCount: account.scanCount,
        scans: account.index?.scans ?? [],
      });
    } catch (err) {
      if (
        err.code === 'STORAGE_ACCESS_DENIED' ||
        err.code === 'STORAGE_IDENTITY_MISMATCH' ||
        err.status === 403
      ) {
        return res.status(403).json({ error: err.message });
      }
      console.error(err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * GET /problems/:id
   * Look up a single problem inside the (mock) bucket structure.
   */
  getProblem(req, res) {
    const { id } = req.params;
    const allProblems = Object.values(this.mockScanResults.problems).flat();
    const problem = allProblems.find((p) => p.id === id);
    if (!problem) {
      return res.status(404).json({ error: 'Problem not found' });
    }
    console.log(`Serving problem ${id}`);
    return res.json(problem);
  }
}

module.exports = ScanController;
