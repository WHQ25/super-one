export type Messages = {
  activity: {
    launcher: {
      browser: string
      terminal: string
    }
  }
  common: {
    cancel: string
    confirm: string
    create: string
    save: string
    saving: string
    delete: string
    close: string
    loading: string
    systemDefault: string
    back: string
    retry: string
    refresh: string
    continue: string
    next: string
    terminal: string
    edit: string
  }
  sidebar: {
    newSession: string
    tabs: {
      sessions: string
      files: string
    }
    pinned: string
    drafts: {
      title: string
      untitled: string
      justNow: string
      minutesAgo: string
      hoursAgo: string
      daysAgo: string
      pendingSync: string
      pendingSyncHint: string
    }
    projects: string
    thisMac: string
    thisPc: string
    hostDisconnected: string
    hostConnectHint: string
    hostUpgrading: string
    hostUpgraded: string
    hostUpgradeFailed: string
    hostOutdatedManual: string
    addProject: {
      title: string
      description: string
      stepTitle: {
        source: string
        browse: string
        github: string
        url: string
        destination: string
      }
      sources: {
        title: string
        searchPlaceholder: string
        local: { label: string; hint: string }
        github: { label: string; hint: string }
        url: { label: string; hint: string }
      }
      pathPlaceholderLocal: string
      pathPlaceholderRemote: string
      repoPlaceholderGithub: string
      repoPlaceholderUrl: string
      destinationPlaceholder: string
      repository: string
      repoInvalidGithub: string
      repoInvalidUrl: string
      githubRepos: string
      githubYourRepos: string
      githubSearchResults: string
      githubSearching: string
      githubNoRepos: string
      githubNeedCli: string
      githubPrivate: string
      clonesInto: string
      cloning: string
      /** Fixed-height hint when submit will mkdir the typed path (or parent). */
      willCreateDirectory: string
      /** Section header for the create-missing-path candidate group. */
      createSection: string
      /** Hint on the create-missing-path candidate row. */
      createDirectory: string
      /** Destination-step checkbox: remember this parent for future clones. */
      saveAsDefaultClonePath: string
      pathRequired: string
      /** Clone failed because `<parent>/<repo>` is already on disk. */
      destinationExists: string
      browse: string
      /** Prefix for the native folder-picker control: "Browse with" + OS icon. */
      browseWith: string
      browseWithFinder: string
      browseWithExplorer: string
      directories: string
      noDirectories: string
      actions: {
        select: string
        continue: string
        add: string
        clone: string
        open: string
        create: string
      }
      hintTab: string
      hintNav: string
      hintBack: string
    }
    sort: {
      title: string
      recent: string
      added: string
    }
    empty: string
    noFiles: string
    search: {
      placeholder: string
      noResults: string
    }
    settings: string
    remote: {
      connected: string
      disconnected: string
      deviceConnectedToast: string
      lanActive: string
      lanInactive: string
      upload: {
        receiving: string
        completed: string
        failed: string
        route: string
      }
    }
    deleteSession: {
      title: string
      descriptionPrefix: string
      descriptionSuffix: string
      dontAsk: string
      delete: string
    }
    removeProject: {
      title: string
      description: string
      remove: string
    }
    renameSession: {
      title: string
    }
    /** One-line chips under session titles (sidebar / switcher / collapsed panel). */
    pending: {
      allowTool: string
      allowApp: string
      allowComputerUse: string
      approveVideoGen: string
      confirmNamed: string
      confirmSettings: string
      confirmConfig: string
      waitingInput: string
      reviewPlan: string
      collabFallback: string
      collabOne: string
      collabOneWithRole: string
      collabTwo: string
      collabMany: string
      agentLaunch: string
      toolFallback: string
    }
    contextMenu: {
      sessionHistory: string
      removeProject: string
      automations: string
      miniApps: string
      workerUptimeS: string
      workerUptimeMS: string
      workerUptimeHM: string
      openMiniApp: string
      stopWorker: string
      runNow: string
      edit: string
      delete: string
      noSessions: string
      showMore: string
      showLess: string
      expandChildren: string
      collapseChildren: string
      searchSessions: string
      rename: string
      renameFile: string
      pin: string
      unpin: string
      hide: string
      unhide: string
      tags: string
      noTags: string
      tagCopiedToast: string
      /** Provider / harness session id (Claude SDK, Codex thread, …). */
      copySessionId: string
      copyWorkingDirectory: string
      openFolder: string
      openInMiniWindow: string
      dragToMiniWindow: string
      forkToWorktree: string
      /** @deprecated Prefer forkToSameWorktree — kept for older UI strings. */
      forkToLocal: string
      /** Same directory / no new worktree (local + remote). */
      forkToSameWorktree: string
      forkingToast: string
      forkedToast: string
      forkedLocalToast: string
      sessionIdCopiedToast: string
      sessionIdNotReadyToast: string
      workingDirCopiedToast: string
      addToChat: string
      copyPath: string
      copyRelativePath: string
      previewInBrowser: string
    }
    appDrawer: {
      buildYourOwn: string
      marketplace: string
      buildAppPrompt: string
    }
  }
  shell: {
    startup: {
      title: string
      tagline: string
      openProject: string
    }
    onboarding: {
      welcome: {
        title: string
        tagline: string
        themeLabel: string
      }
      discover: {
        title: string
        subtitle: string
        scanning: string
        rescan: string
        detected: string
        notFound: string
        willDownload: string
        useManaged: string
        enableSelected: string
        skip: string
        enabling: string
        enableFailed: string
        ids: {
          claude: string
          codex: string
          opencode: string
          cursor: string
          'acp-grok': string
        }
      }
    }
    harnessAlign: {
      title: string
      subtitle: string
      checking: string
      failed: string
    }
    setup: {
      required: { title: string; description: string }
      installing: { title: string; description: string }
      success: { title: string; description: string }
      error: { title: string; description: string }
      install: string
    }
    update: {
      checking: string
      available: string
      availableHint: string
      preparing: string
      preparingShort: string
      upToDate: string
      downloading: string
      downloadingWithProgress: string
      downloadingHarnessWithProgress: string
      harnessFailed: string
      harnessError: string
      retryHarness: string
      ready: string
      restart: string
    }
    mosaic: {
      noSpace: string
    }
  }
  settings: {
    layout: {
      tabs: {
        general: string
        appearance: string
        browser: string
        computerUse: string
        apps: string
        remote: string
        usage: string
        mediaGen: string
        providers: string
        harnesses: string
        agents: string
        skills: string
        mcp: string
        hooks: string
        plugins: string
        preferences: string
        account: string
        cloud: string
        models: string
      }
      providers: {
        claude: string
        codex: string
      }
    }
    harnesses: {
      title: string
      subtitle: string
      hint: string
      loading: string
      enable: string
      disable: string
      enabled: string
      disabled: string
      installing: string
      progress: string
      needsAuth: string
      sourceManaged: string
      sourceExternal: string
      groupEnabled: string
      groupDisabled: string
      dragHandle: string
      selectHint: string
      experimentalBadge: string
      experimentalAcpHint: string
      configSection: string
      fields: {
        source: string
        version: string
        command: string
      }
      desc: {
        claude: string
        codex: string
        opencode: string
        cursor: string
        acpGrok: string
        experimentalAcp: string
      }
      ids: {
        claude: string
        codex: string
        opencode: string
        cursor: string
        'acp-grok': string
      }
      cursor: {
        apiKeyTitle: string
        apiKeyDescription: string
        apiKeySaved: string
        apiKeyConfigured: string
        apiKeyConfiguredAnonymous: string
        apiKeyMissing: string
        apiKeyReplacePlaceholder: string
        saveKey: string
        replaceKey: string
        cloudTitle: string
        cloudDescription: string
        cloudEnabled: string
        localEnabled: string
        autoCreatePr: string
        workOnCurrentBranch: string
        saveRuntime: string
        modelsTitle: string
        modelsDescription: string
        modelsEmpty: string
        modelsEnableAll: string
        modelsDisableAll: string
        settingSourcesTitle: string
        settingSourcesDescription: string
        settingSourceProject: string
        settingSourceUser: string
        settingSourcePlugins: string
        envVarsTitle: string
        envVarsDescription: string
        envVarsPlaceholder: string
        forceRecoverTitle: string
        forceRecoverDescription: string
        forceRecoverAction: string
        forceRecoverNeedSession: string
        forceRecoverLocalOnly: string
        forceRecoverDone: string
        cloudAgentsTitle: string
        cloudAgentsEmpty: string
        cloudAgentsRefresh: string
        cloudAgentsArchive: string
        cloudAgentsDelete: string
        browserLogin: string
        browserLoginDescription: string
        browserLoginDone: string
        browserLogout: string
        toolPresetTitle: string
        toolPresetDescription: string
        toolPresetDefault: string
        toolPresetReadonly: string
        toolPresetNoShell: string
        usageTitle: string
        usageRefresh: string
        usageEmpty: string
        usageTokens: string
        usageCost: string
      }
      states: {
        disabled: string
        missing: string
        installing: string
        needs_auth: string
        ready: string
        incompatible: string
        error: string
      }
    }
    remote: {
      pageTitle: string
      pageSubtitle: string
      tabs: {
        thisComputer: string
        thisMac: string
        otherDevices: string
      }
      thisDevice: {
        mobile: { title: string; description: string; empty: string }
        desktop: { title: string; description: string; empty: string }
      }
      otherDevices: {
        title: string
        subtitle: string
      }
      channels: {
        addDevice: string
        empty: string
        desktop: { title: string; description: string }
        ssh: { title: string; description: string }
        tailscale: { title: string; description: string }
        localLab: {
          title: string
          description: string
          connect: string
          reconnect: string
          offline: string
          online: string
          startHint: string
          connectSuccess: string
          connectSuccessExisting: string
          refreshStatus: string
        }
      }
    }
    environments: {
      title: string
      subtitle: string
      connect: string
      disconnect: string
      forget: string
      forgetConfirm: string
      addSuccess: string
      credentialInMemoryOnly: string
      noSessionsCapability: string
      nodeOutdated: string
      nodeOutdatedManual: string
      upgradeNode: string
      upgradingNode: string
      upgradeNodeSuccess: string
      harness: {
        title: string
        loading: string
        empty: string
        enable: string
        disable: string
        enabled: string
        disabled: string
        needsAuth: string
        ids: {
          claude: string
          codex: string
          opencode: string
          cursor: string
          'acp-grok': string
        }
      }
      state: {
        available: string
        connecting: string
        synchronizing: string
        connected: string
        disconnected: string
        backoff: string
        blocked: string
      }
      blockReason: {
        auth: string
        protocol_incompatible: string
        revoked: string
        invalid_config: string
        identity_conflict: string
        user: string
      }
      add: {
        trigger: string
        title: string
        description: string
        titleSsh: string
        descriptionSsh: string
        sshTab: string
        manualTab: string
        knownHostsTab: string
        addNewHostTab: string
        sshHostsLabel: string
        sshHostsHint: string
        sshHostsEmpty: string
        sshPickRequired: string
        sshManualOption: string
        manualSshSection: string
        destination: string
        destinationHint: string
        autoInstallHint: string
        uploadInstallHint: string
        useLocalUpload: string
        useLocalUploadHint: string
        advanced: string
        autoDetected: string
        remoteExec: string
        remoteExecHint: string
        remotePort: string
        sshPort: string
        identityFile: string
        identityFileHint: string
        label: string
        progress: {
          probing: string
          npm: string
          upload: string
          verify: string
          extract: string
          activate: string
          starting: string
          pairing: string
        }
        submit: string
      }
    }
    appearance: {
      title: string
      subtitle: string
      interface: string
      theme: {
        label: string
        system: string
        light: string
        dark: string
      }
    }
    browser: {
      title: string
      subtitle: string
      surface: {
        label: string
        description: string
        compact: string
        legacy: string
      }
      cdp: {
        label: string
        description: string
      }
      experimental: {
        title: string
        description: string
        requiresCdp: string
        cookies: { label: string; description: string }
        emulate: { label: string; description: string }
        mock: { label: string; description: string }
      }
    }
    computerUse: {
      title: string
      subtitle: string
      enable: {
        label: string
        description: string
      }
      allowAll: {
        label: string
        description: string
      }
      alwaysAllow: {
        title: string
        description: string
        add: string
        empty: string
        remove: string
        searchPlaceholder: string
        loadingApps: string
        emptyRunning: string
      }
      permissions: {
        title: string
        description: string
        button: string
        buttonGranted: string
        requestAccessibility: string
        requestScreenRecording: string
        opening: string
        checking: string
        requested: string
        alreadyGranted: string
        accessibility: string
        screenRecording: string
        accessibilityGrantedShort: string
        accessibilityMissing: string
        screenRecordingGrantedShort: string
        screenRecordingMissing: string
        helperName: string
        dragHint: string
        stepAccessibility: string
        stepScreenRecording: string
        dragHintAccessibility: string
        dragHintScreenRecording: string
        accessibilityGranted: string
        accessibilityGrantedHint: string
        continueToScreenRecording: string
        screenRecordingGranted: string
        allGrantedHint: string
        done: string
        recheck: string
        rechecking: string
        recheckStillMissing: string
      }
    }
    general: {
      title: string
      subtitle: string
      privacy: string
      appearance: string
      updates: string
      languageRegion: string
      terminal: string
      terminalTheme: {
        light: string
        dark: string
      }
      terminalFontSize: {
        label: string
        description: string
      }
      terminalFont: {
        label: string
        description: string
      }
      mermaid: string
      mermaidTheme: {
        light: string
        dark: string
      }
      uiFont: {
        label: string
        description: string
      }
      font: {
        systemDefault: string
      }
      analytics: {
        label: string
        description: string
        enabled: string
        disabled: string
      }
      media: string
      imageProvider: {
        label: string
        description: string
        auto: string
      }
      videoProvider: {
        label: string
        description: string
        auto: string
      }
      harness: string
      defaultHarness: {
        label: string
        description: string
        auto: string
        updated: string
      }
      secondaryHarness: {
        label: string
        description: string
        auto: string
        updated: string
        duplicate: string
      }
      harnessOptions: {
        claude: string
        codex: string
        opencode: string
      }
      experimental: string
      experimentalAgents: {
        label: string
        description: string
        enabled: string
        disabled: string
      }
      experimentalClaudeOpenAiChat: {
        label: string
        description: string
        enabled: string
        disabled: string
      }
      experimentalRemoteNodes: {
        label: string
        description: string
        enabled: string
        disabled: string
      }
      autoExpandFileDiffs: {
        label: string
        description: string
      }
      detailChatMode: {
        label: string
        description: string
      }
      crispText: {
        label: string
        description: string
      }
      liquidGlass: {
        label: string
        description: string
      }
      language: {
        label: string
        description: string
        system: string
        english: string
        chinese: string
        updated: string
      }
      appIcon: {
        label: string
        description: string
        choose: string
        reset: string
        updated: string
        resetDone: string
      }
      updateChannel: {
        label: string
        description: string
        stable: string
        beta: string
        alpha: string
        stableDescription: string
        betaDescription: string
        alphaDescription: string
        updated: string
      }
      checkUpdates: {
        label: string
        description: string
        action: string
        failed: string
      }
    }
    preferences: {
      title: string
      claudeSubtitle: string
      codexSubtitle: string
      import: {
        section: string
        label: string
        description: string
        detect: string
        detecting: string
        none: string
        dialogTitle: string
        dialogDescription: string
        confirm: string
        importing: string
        done: string
        error: string
      }
      sections: { project: string; user: string }
      /** Empty state when Codex preferences has no project-scoped fields. */
      projectEmptyCodex: string
      defaultProvider: { label: string; description: string }
      outputStyle: {
        label: string
        description: string
        defaultName: string
        updated: string
      }
      permissionMode: {
        label: string
        description: string
        updated: string
      }
      sandbox: {
        label: string
        description: string
        menuTitle: string
        updated: string
        statusUnsupported: string
        statusReady: string
        statusMissing: string
        statusNotProbed: string
        installHintTitle: string
        probeNow: string
        reProbe: string
      }
      defaultModel: {
        label: string
        claudeDescription: string
        codexDescription: string
        loading: string
        empty: string
        emptyNoProject: string
        claudeUpdated: string
        claudeSystemDefault: string
        codexUpdated: string
        codexSystemDefault: string
      }
      effort: {
        label: string
        description: string
        chooseModel: string
        unsupported: string
        updated: string
        systemDefault: string
        levels: {
          low: string
          medium: string
          high: string
          xhigh: string
          max: string
        }
      }
      reasoningEffort: {
        label: string
        description: string
        updated: string
        systemDefault: string
      }
      askPreviewFormat: {
        label: string
        description: string
        updated: string
        options: { markdown: string; html: string }
      }
    }
    usage: {
      title: string
      backfilling: string
      presets: {
        today: string
        '7d': string
        '30d': string
        '90d': string
        all: string
      }
      harness: {
        all: string
        claude: string
        codex: string
        grok: string
        cursor: string
        opencode: string
      }
      summary: {
        totalTokens: string
        estimatedCost: string
        estimatedCostHint: string
        unpricedHint: string
        sessions: string
        messages: string
      }
      daily: {
        titleByHarness: string
        titleByTokenType: string
        titleToday: string
        titleHeatmap: string
        empty: string
      }
      heatmap: {
        less: string
        more: string
        tokens: string
        noActivity: string
      }
      tokenTypes: {
        input: string
        output: string
        cacheRead: string
        cacheCreation: string
      }
      tooltip: {
        total: string
        avg: string
      }
      byModel: {
        title: string
        empty: string
        harness: string
        model: string
        total: string
        cost: string
        unpriced: string
        input: string
        output: string
        cacheRead: string
        cacheCreation: string
      }
    }
  }
  chat: {
    compactMode: {
      detail: string
      toolCalls: string
      filesChanged: string
    }
    placeholder: {
      addInstructions: string
      debugBug: string
      codexPlan: string
      codexReject: string
      codexAsk: string
      claudePlan: string
      claudeAsk: string
      openCodePlan: string
      openCodeAsk: string
      cursorPlan: string
      cursorAsk: string
      acpPlan: string
      acpAsk: string
    }
    acpCommands: {
      clearDesc: string
      recapDesc: string
      loading: string
      updating: string
      loadingHint: string
    }
    dropToAttach: string
    contextUsage: {
      usedOfMax: string
      percent: string
      tokens: string
      exceeds: string
      cost: string
      free: string
    }
    /** Composer send failures (local IPC or remote node). */
    send: {
      failed: string
      remoteUnavailable: string
    }
    cursor: {
      apiKeyPrompt: {
        title: string
        description: string
        placeholder: string
        getKey: string
        save: string
      }
    }
    permissionModeTitle: string
    sessionModeTitle: string
    sandboxModeTitle: string
    permissionModes: {
      default: { label: string; description: string }
      acceptEdits: { label: string; description: string }
      auto: { label: string; description: string }
      plan: { label: string; description: string }
      dontAsk: { label: string; description: string }
      bypassPermissions: { label: string; description: string }
    }
    /** Grok Build / ACP permission baseline — product language differs from Claude. */
    acpPermissionModes: {
      title: string
      subtitle: string
      ask: { label: string; description: string }
      plan: { label: string; description: string }
      auto: { label: string; description: string }
      alwaysApprove: { label: string; description: string }
    }
    /** Cursor SDK modes — Agent / Plan / Full Access (sandbox is separate). */
    cursorPermissionModes: {
      agent: { label: string; description: string }
      plan: { label: string; description: string }
      fullAccess: { label: string; description: string }
    }
    sandboxModes: {
      off: { label: string; description: string }
      on: { label: string; description: string }
      auto: { label: string; description: string }
    }
    sandboxUnsupportedTooltip: string
    sandboxConditionalNotReady: string
    suggestions: {
      openProject: string
      addProject: string
      poweredBy: string
      selectProject: string
      noProjects: string
      others: string
      acpLabel: string
      selectAgent: string
      agentNotInstalled: string
      agentInstallHint: string
      noHarnessEnabled: string
      enableHarnesses: string
    }
    additionalDirs: {
      label: string
      scopes: {
        user: string
        project: string
        session: string
      }
    }
    plan: {
      review: string
      requestedPermissions: string
      approve: string
      approveAccept: string
      approveAuto: string
      reject: string
      feedbackPlaceholder: string
      /** Freeform when both approve and reject can carry feedback (Grok/ACP). */
      feedbackPlaceholderBoth: string
      commentHint: string
      emptyPlan: string
      comments: string
      commentOn: string
      addComment: string
      commentPlaceholder: string
      saveComment: string
      cancelComment: string
      removeComment: string
      editComment: string
      switchTo: string
      acceptEdits: string
      auto: string
      afterApproval: string
      label: string
      approved: string
      rejected: string
      planApproved: string
      planRejected: string
    }
    rewind: {
      title: string
      confirmDescription: string
      cannotRestore: string
      previewFailed: string
      codeAlreadyRestored: string
      changes: string
      andOtherFiles_one: string
      andOtherFiles_other: string
      noEffectNote: string
      restoring: string
      options: {
        codeAndChat: string
        conversation: string
        code: string
        cancel: string
      }
      toast: {
        codeAndChat: string
        conversation: string
        code: string
      }
    }
    scrollIndicator: {
      compactTitle: string
      compactExpandedDesc: string
      compactCollapsedDesc: string
      expandTooltip: string
      collapseTooltip: string
    }
    /** Grok last-turn summary / session recap chrome labels. */
    turnMeta: {
      summaryLabel: string
      recapLabel: string
      generatingRecap: string
    }
    /** Background-task wake whose launching tool block is gone or off-turn. */
    taskNotification: {
      completed: string
      failed: string
      stopped: string
      outputFile: string
    }
    pasteChip: {
      title_one: string
      title_other: string
      unsaved: string
    }
    userSelectionChip: {
      title_one: string
      title_other: string
      popoverTitle_one: string
      popoverTitle_other: string
    }
    selectionMenu: {
      copy: string
      addToChat: string
    }
    codex: {
      statusRunning: string
      statusReading: string
      statusSearching: string
      startingMcpServers: string
      mcpNeedsReauth: string
      mcpStartupFailed: string
      mcpReauthenticating: string
      mcpReauthSuccess: string
      mcpReauthFailed: string
      runningInline: string
      waitingFor: string
      waitingForWithElapsed: string
      fallbackAgentName: string
      codexError: string
      startReview: string
      reviewComplete: string
      conversationCompacted: string
      sendingFollowUp: string
      sendFollowUp: string
      followUpSent: string
      loadImage: string
      imageGenerationFailed: string
      imageLoadFailed: string
      generatedImageAlt: string
      appToolCalls_one: string
      appToolCalls_other: string
      commandGroupRead_one: string
      commandGroupRead_other: string
      commandGroupSearch_one: string
      commandGroupSearch_other: string
      commandGroupCombined: string
      exploringCode: string
      exploreCode: string
      codeExplored: string
      modelFallback: string
      permissionPreset: string
      goal: {
        label: string
        title: string
        description: string
        noThread: string
        placeholder: string
        save: string
        edit: string
        pause: string
        resume: string
        clear: string
        status: string
        statuses: {
          active: string
          paused: string
          blocked: string
          usageLimited: string
          budgetLimited: string
          complete: string
        }
      }
    }
    image: {
      copyImage: string
      copyPrompt: string
      openFolder: string
      addToChat: string
      download: string
      copied: string
      promptCopied: string
      copyFailed: string
      downloaded: string
      downloadFailed: string
      generatedIn: string
      noMetadata: string
      prompt: string
      warnings: string
      paramProvider: string
      paramModel: string
      paramSize: string
      paramAspectRatio: string
      paramReferenceImages: string
    }
    worktree: {
      searchPlaceholder: string
      existingHeading: string
      createFromHeading: string
      attachToHeading: string
      detachAtHeading: string
      modeBranch: string
      modeAttach: string
      modeDetach: string
      baseBranchLabel: string
      branchNameLabel: string
      branchNamePlaceholder: string
      branchExists: string
      switchToAttach: string
      attachUnavailableMain: string
      attachUnavailableOther: string
      attachInfo: string
      detachInfo: string
      lazyHint: string
      detachedLabel: string
      attachedLabel: string
      fromLabel: string
      cleanLabel: string
      filesCount_one: string
      filesCount_other: string
      carryLocalChanges: string
      noMatches: string
      createFromLabel: string
      triggerCreateFrom: string
      triggerAttachTo: string
      triggerCreateBranch: string
      triggerActiveBranch: string
      triggerActiveDetached: string
      forkHeading: string
      forkInfo: string
      forkIncludesChanges: string
      forkButton: string
      handoffHeading: string
      handoffInfo: string
      handoffButton: string
      handoffSuccess: string
      handoffErrorNoChanges: string
      handoffErrorLocalDirty: string
      handoffErrorConflict: string
      handoffErrorNotWorktree: string
      handoffErrorGeneric: string
      assignHeading: string
      assignInfo: string
      assignPlaceholder: string
      assignButton: string
      assignSuccess: string
      assignErrorExists: string
      assignErrorCheckedOut: string
      assignErrorGeneric: string
    }
    git: {
      init: string
      initHint: string
      initSuccess: string
      initFailed: string
    }
    permission: {
      sandboxNetwork: string
      allowSandboxNetwork: string
      sandboxOverride: string
      networkAccess: string
      blockedPath: string
      inputHeading: string
      suggestionsHeading: string
      allow: string
      allowForSession: string
      decline: string
      deny: string
      denyReasonPlaceholder: string
      alwaysAllow: string
      sessionCleanupTitle: string
      sessionCleanupEmpty: string
      sessionCleanupDelete: string
      sessionCleanupCancel: string
      /** Group header when a cleanup id's project is no longer in recentFolders. */
      sessionCleanupUnknownProject: string
      /** automation_apply / automation_delete HITL */
      automationCreateTitle: string
      automationUpdateTitle: string
      automationDeleteTitle: string
      automationEmpty: string
      automationFieldName: string
      automationFieldSchedule: string
      automationFieldAgent: string
      automationFieldEnabled: string
      automationFieldPrompt: string
      automationEnabledOn: string
      automationEnabledOff: string
      automationChangeFromTo: string
    }
    computerUseGrant: {
      badge: string
      title: string
      description: string
      collapsed: string
      viaTool: string
      allowSession: string
      alwaysAllow: string
      deny: string
    }
    videoGenConfirm: {
      title: string
      promptLabel: string
      promptPlaceholder: string
      providerLabel: string
      modelLabel: string
      aspectRatioLabel: string
      resolutionLabel: string
      durationLabel: string
      advancedOptions: string
      fpsLabel: string
      fpsPlaceholder: string
      seedLabel: string
      seedPlaceholder: string
      generateAudio: string
      watermark: string
      lockCamera: string
      confirm: string
      reject: string
      feedbackPlaceholder: string
      startFrame: string
      endFrame: string
      reference: string
    }
    videoGenToolBlock: {
      label: string
      generating: string
      submitted: string
      rendering: string
      completed: string
      failed: string
      referenceMaterials: string
      firstFrame: string
      lastFrame: string
      referenceImages: string
      referenceVideos: string
      referenceAudio: string
      reference: string
      prompt: string
      provider: string
      model: string
      aspectRatio: string
      resolution: string
      duration: string
      fps: string
      seed: string
      generateAudio: string
      watermark: string
      cameraFixed: string
      on: string
      off: string
      warnings_one: string
      warnings_other: string
    }
    configConfirm: {
      title: string
      confirm: string
      deleteConfirm: string
      reject: string
      feedbackPlaceholder: string
      currentValue: string
      defaultOption: string
      clearedValue: string
      emptyValue: string
      modelCount: string
    }
    sessionAgentsConfirm: {
      title: string
      subtitle: string
      defaultProvider: string
      workingDirectory: string
      peerSession: string
      peerProject: string
      /** Prefix before a clickable peer session title, e.g. "Work with:" */
      workWith: string
      /** Tooltip / a11y for opening the peer session from the confirm card. */
      openPeerSession: string
      expandTask: string
      collapseTask: string
      hintSwitch: string
      reject: string
      approve: string
    }
    collaboration: {
      initialTask: string
      fromAgent: string
      toAgent: string
      taskNotification: string
      mailboxReady: string
      expandTask: string
      collapseTask: string
    }
    askUser: {
      otherOption: string
      selectOptionPreview: string
      noteOptionalPlaceholder: string
      submit: string
      hintSwitch: string
      hintNote: string
      hintSelect: string
      hintDismiss: string
    }
    toolBlock: {
      enteredPlanMode: string
      readingWidgetGuidelines: string
      readWidgetGuidelines: string
      readingMiniAppGuide: string
      readMiniAppGuide: string
      readingMediaGuide: string
      readMediaGuide: string
      readingConfig: string
      readConfig: string
      readingManual: string
      readManual: string
      guideOverview: string
      applyingSettings: string
      appliedSettings: string
      settingsChangeRejected: string
      settingsChangeCancelled: string
      settingsChangeFailed: string
      settingsChangeCount: string
      configCreated: string
      configUpdated: string
      configDeleted: string
      generatingImage: string
      generatedImage: string
      generateImage: string
      image: {
        fields: {
          prompt: string
          provider: string
          model: string
          aspectRatio: string
          size: string
          referenceImages: string
          reference: string
        }
      }
      generatingVideo: string
      generatedVideo: string
      generateVideo: string
      listingMediaProviders: string
      listedMediaProviders: string
      listMediaProviders: string
      mediaProvidersMatched: string
      registeringMiniApp: string
      registeredMiniApp: string
      registerMiniApp: string
      updatingMiniAppTypes: string
      updatedMiniAppTypes: string
      updateMiniAppTypes: string
      listingWidgetTemplates: string
      listedWidgetTemplates: string
      listWidgetTemplates: string
      checkingVideoStatus: string
      checkVideoStatus: string
      settingUpMiniApp: string
      setUpMiniApp: string
      setupMiniApp: string
      setUpMiniAppFailed: string
      updateSettings: string
      createSettings: string
      deleteSettings: string
      readSettings: string
      readManualAction: string
      setupFields: {
        directory: string
        description: string
        appId: string
      }
      packing: string
      miniAppPacked: string
      generatingWidget: string
      generateWidget: string
      collab: {
        requestingCollaboration: string
        collaborationRequested: string
        startingCollaborationSession: string
        collaborationSessionStarted: string
        sendingMessageTo: string
        messageSent: string
        retrievingMessages: string
        messagesRetrieved: string
        messageReceived: string
        /** Primary retrieve header: noun + past participle, with arrival count. */
        receivedMessageCount: string
        noMessages: string
        agentCount: string
        messageCount: string
        /** Only shown when remaining > 0 (omit the usual zero). */
        remainingCount: string
        agentSession: string
        reused: string
        showFullMessage: string
        showLessMessage: string
        fields: {
          name: string
          model: string
          effort: string
          permission: string
          sandbox: string
          cwd: string
          role: string
          sessionId: string
          to: string
          from: string
          message: string
        }
      }
      /** project_list / session_list / session_search / session_read / session_cleanup — casing mirrors collab. */
      archive: {
        listingProjects: string
        projectsListed: string
        listProjects: string
        projectListFailed: string
        projectCount: string
        emptyProjects: string
        thisProject: string
        missingProject: string
        openProject: string
        listingSessions: string
        sessionsListed: string
        listSessions: string
        listFailed: string
        searchingSessions: string
        sessionSearch: string
        searchSessions: string
        hitsFound: string
        noHits: string
        searchFailed: string
        readingSessionMeta: string
        sessionMeta: string
        readSessionMeta: string
        readingUserMessages: string
        userMessages: string
        readUserMessages: string
        readingAssistantMessages: string
        assistantMessages: string
        readAssistantMessages: string
        readingConversation: string
        conversation: string
        readConversation: string
        readingToolIndex: string
        toolIndex: string
        readToolIndex: string
        readingToolDetail: string
        toolDetail: string
        readToolDetail: string
        readFailed: string
        previewingCleanup: string
        cleanupPreview: string
        hidingSessions: string
        sessionsHidden: string
        hideSessions: string
        unhidingSessions: string
        sessionsUnhidden: string
        unhideSessions: string
        confirmingDelete: string
        sessionsDeleted: string
        deleteSessions: string
        sessionsDeletedPartial: string
        deleteCancelled: string
        deleteRejected: string
        cleanupFailed: string
        sessionCount: string
        candidateCount: string
        partialDeleteSummary: string
        beforeDate: string
        thisChat: string
        pinned: string
        emptySessions: string
        emptyHits: string
        openSession: string
        deletedSection: string
        failedSection: string
        affectedSection: string
        candidatesSection: string
        wereCandidatesSection: string
        skippedPinnedSection: string
        pageHint: string
        taggingSession: string
        sessionTagged: string
        tagSession: string
        tagFailed: string
        fields: {
          title: string
          harness: string
          messages: string
          active: string
          model: string
          branch: string
          sessionId: string
          tool: string
          id: string
          input: string
          result: string
          tag: string
          sessions: string
        }
      }
      /** automation_list / automation_apply / automation_delete — casing mirrors collab. */
      automation: {
        listingAutomations: string
        automationsListed: string
        listAutomations: string
        readingAutomation: string
        automationDetail: string
        readAutomation: string
        listFailed: string
        empty: string
        automationCount: string
        automationCreated: string
        createAutomation: string
        automationUpdated: string
        updateAutomation: string
        enableAutomation: string
        disableAutomation: string
        deleteAutomations: string
        confirmingCreate: string
        confirmingUpdate: string
        confirmingEnable: string
        confirmingDisable: string
        automationEnabled: string
        automationDisabled: string
        createFailed: string
        updateFailed: string
        enableFailed: string
        disableFailed: string
        createCancelled: string
        updateCancelled: string
        enableCancelled: string
        disableCancelled: string
        createRejected: string
        updateRejected: string
        enableRejected: string
        disableRejected: string
        confirmingDelete: string
        automationsDeleted: string
        automationsDeletedPartial: string
        nothingDeleted: string
        deleteCancelled: string
        deleteRejected: string
        deleteFailed: string
        partialDeleteSummary: string
        deletedSection: string
        failedSection: string
        enabled: string
        disabled: string
        fields: {
          name: string
          schedule: string
          status: string
          prompt: string
          agent: string
        }
      }
      dismissed: string
      denied: string
      error: string
      running: string
      runningInline: string
      timedOut: string
      outputFileExpired: string
      collapse: string
      moreLines_one: string
      moreLines_other: string
      showFullCommand: string
      collapseCommand: string
      showFullOutput: string
      collapseOutput: string
      browser: {
        navigate: string
        navigating: string
        open: string
        opening: string
        snapshot: string
        snapshotting: string
        query: string
        querying: string
        inspect: string
        inspecting: string
        screenshot: string
        screenshotting: string
        click: string
        clicking: string
        hover: string
        hovering: string
        type: string
        typing: string
        press: string
        pressing: string
        scroll: string
        scrolling: string
        drag: string
        dragging: string
        select: string
        selecting: string
        waitFor: string
        waitingFor: string
        evaluate: string
        evaluating: string
        tabs: string
        listingTabs: string
        resize: string
        resizing: string
        networkStart: string
        recordingNetwork: string
        networkStop: string
        collectingNetwork: string
        networkWait: string
        waitingForRequest: string
        networkBody: string
        loadingResponseBody: string
        cookies: string
        readingCookies: string
        uploadFile: string
        uploadingFile: string
        download: string
        downloading: string
        downloaded: string
        downloadBackground: string
        downloadBackgroundHint: string
        downloadSaveTo: string
        downloadSaved: string
        downloadSaveFailed: string
        downloadPath: string
        downloadSize: string
        downloadMime: string
        downloadUrl: string
        downloadProgress: string
        listDownloads: string
        listingDownloads: string
        listDownloadsEmpty: string
        downloadStateCompleted: string
        downloadStateProgressing: string
        downloadStateCancelled: string
        downloadStateInterrupted: string
        emulate: string
        emulating: string
        mock: string
        mocking: string
        actionList: string
        listingActions: string
        actionSave: string
        savingAction: string
        actionDo: string
        doingAction: string
        elements_one: string
        elements_other: string
        matches_one: string
        matches_other: string
        tabsCount_one: string
        tabsCount_other: string
        requests_one: string
        requests_other: string
        cookiesCount_one: string
        cookiesCount_other: string
        downloads_one: string
        downloads_other: string
        actions_one: string
        actions_other: string
        notFound: string
        viewport: string
        screenshotUnavailable: string
        code: string
        result: string
        mockUrl: string
        mockStatus: string
        mockContentType: string
        mockBody: string
      }
      computer: {
        apps: string
        listingApps: string
        focus: string
        focusing: string
        launch: string
        launching: string
        snapshot: string
        snapshotting: string
        zoom: string
        zooming: string
        query: string
        querying: string
        search: string
        searching: string
        expand: string
        expanding: string
        inspect: string
        inspecting: string
        act: string
        acting: string
        click: string
        clicking: string
        type: string
        typing: string
        press: string
        pressing: string
        scroll: string
        scrolling: string
        drag: string
        dragging: string
        movePointer: string
        movingPointer: string
        waitFor: string
        waitingFor: string
        screenshot: string
        screenshotUnavailable: string
        json: string
        appsCount_one: string
        appsCount_other: string
        windowsCount_one: string
        windowsCount_other: string
        matchesCount_one: string
        matchesCount_other: string
        outcome: {
          worked: string
          didnt: string
          unknown: string
        }
        waitStatus: {
          preexisting: string
          verified: string
          failed: string
        }
      }
    }
    subagent: {
      spawning: string
      runningInBackground: string
      running: string
      done: string
      failed: string
      stopped: string
      output: string
      prompt: string
      title: string
      notFound: string
      openFullView: string
      noActivity: string
      retrying: string
    }
    codexCollab: {
      defaultName: string
      errored: string
      failed: string
      openFullView: string
      backToMain: string
      forked: string
      failureSummary: string
      failureNotFound: string
      failureNoDetails: string
      turnCount_one: string
      turnCount_other: string
      noItems: string
      noOutput: string
      toolLabels: {
        spawnAgent: string
        sendInput: string
        resumeAgent: string
        wait: string
        closeAgent: string
      }
      turnLabels: {
        spawnAgent: string
        sendInput: string
        resumeAgent: string
        wait: string
        closeAgent: string
      }
      miniTool: {
        bash: string
        edit: string
        webSearch: string
        filesFallback_one: string
        filesFallback_other: string
      }
    }
    codexCommands: {
      helpDesc: string
      resetDesc: string
      authDesc: string
      authAutoDesc: string
      authChatgptDesc: string
      authApiKeyDesc: string
      authApiKeyArg: string
      reviewDesc: string
      compactDesc: string
      planDesc: string
      providerDesc: string
      mcpDesc: string
      goalDesc: string
      goalArg: string
    }
    providerPopup: {
      title: string
      addProvider: string
      willSwitchAfterStreaming: string
    }
    mcpPopup: {
      title: string
      liveBadge: string
      probeBadge: string
      empty: string
      emptyHint: string
      manageInSettings: string
      refresh: string
      noActiveSession: string
      errorBadge: string
      authBadge: string
      authenticate: string
    }
    slashCommand: {
      groupCommands: string
      groupSkills: string
    }
    mentionPopup: {
      groupCapabilities: string
      groupSessions: string
      groupDesktopApps: string
      groupAgents: string
      groupMiniApps: string
      groupFiles: string
      capabilityCollab: string
      capabilityComputer: string
      capabilityBrowser: string
      capabilityWidget: string
      capabilityDebug: string
      capabilitySession: string
      groupSessionProjects: string
      groupRecentSessions: string
      noSessions: string
      noRecentSessions: string
      noProjects: string
      sessionNeedTitle: string
      sessionNeedTitleShort: string
      sessionPickProject: string
      sessionAllProjects: string
      sessionAllProjectsHint: string
      hintSelectSession: string
      hintCompleteProject: string
      hintTypeTitle: string
      loadingSessions: string
      scrollForMore: string
      disabled: string
      computerUseDisabledHint: string
      browserDisabledHint: string
    }
    linkSafety: {
      openExternal: string
      copyLink: string
      copied: string
      openLink: string
      openInApp: string
      openInAppHint: string
    }
    browser: {
      addressPlaceholder: string
      previewLabel: string
      previewExpandedLabel: string
      previewHide: string
      previewExpand: string
      previewShrink: string
      screenshotCopied: string
      screenshotFailed: string
      quickAnnotate: string
      quickAnnotateWithScreenshot: string
      copyText: string
      addTextToChat: string
      addImageToChat: string
      copyImage: string
      copyImageAddress: string
      saveImage: string
      imageSaved: string
      imageSaveFailed: string
      openLinkNewTab: string
      openLinkExternal: string
      copyLink: string
      inspect: string
      annotateEnter: string
      annotateExit: string
      annotating: string
      annotateElement: string
      annotateRegion: string
      annotationCount_one: string
      annotationCount_other: string
      annotatePlaceholder: string
      annotateConfirm: string
      annotateCancel: string
      annotateScreenshot: string
      styleColor: string
      styleBackground: string
      styleSize: string
      styleWeight: string
      styleRadius: string
      stylePadding: string
      searchFor: string
      bookmark: string
      bookmarkEdit: string
      bookmarkAdded: string
      bookmarkName: string
      bookmarkUrl: string
      bookmarkNoFolder: string
      bookmarkRemove: string
      bookmarkDone: string
      bookmarks: string
      openExternal: string
      zoom: string
      zoomIn: string
      zoomOut: string
      zoomReset: string
      newFolder: string
      newFolderName: string
      renameFolder: string
      folderNamePlaceholder: string
      folderExists: string
      removeFromFolder: string
      noBookmarks: string
      deleteFolder: string
      emptyFolder: string
      insecureTitle: string
      insecureBody: string
      insecureDetails: string
      insecureHide: string
      insecureAdvanced: string
      insecureProceed: string
      insecureBack: string
      insecureReasonExpired: string
      insecureReasonName: string
      insecureReasonAuthority: string
      insecureReasonGeneric: string
    }
    reasoning: {
      thinking: string
      thinkingSeconds: string
      thought: string
      thoughtSeconds: string
    }
    mermaid: {
      label: string
      error: string
    }
  }
  resources: {
    sectionUser: string
    sectionProject: string
    agents: {
      title: string
      subtitle: string
      empty: string
      emptyHint: string
    }
    skills: {
      title: string
      subtitleClaude: string
      subtitleCodex: string
      empty: string
      emptyHintClaude: string
      emptyHintCodex: string
      install: string
      selectFile: string
      deleteTitle: string
      deleteDescSuffix: string
      deleting: string
      delete: string
      deleteTooltip: string
      previewToggle: string
      sourceToggle: string
      hideFromAgent: string
      showToAgent: string
      disabled: string
      builtin: string
      plugin: string
      readonly: string
    }
    providers: {
      title: string
      subtitleClaude: string
      subtitleCodex: string
      subtitleUnified: string
      activateFor: string
      enabled: string
      disabled: string
      selectHint: string
      defaultImageProviderLabel: string
      defaultImageProviderDescription: string
      defaultImageProviderAuto: string
      add: string
      addCustom: string
      addKey: string
      newKey: string
      others: string
      keyCount_one: string
      keyCount_other: string
      accountPlan: string
      accountEmail: string
      accountOrg: string
      accountSignIn: string
      accountNotSignedIn: string
      accountLoading: string
      codexNeedsProject: string
      keyNameDuplicate: string
      deleteKeyTitle: string
      deleteKeyDescription: string
      setDefault: string
      default: string
      defaultLabelClaude: string
      defaultLabelCodex: string
      defaultDescClaude: string
      defaultDescCodex: string
      empty: string
      emptyHint: string
      updateAvailable: string
      official: string
      useForTitle: string
      useForClaude: string
      useForCodex: string
      useForImage: string
      useForVideo: string
      useForTts: string
      useForAsr: string
      getKey: string
      apiKeys: string
      keyLabel: string
      keyNameConflict: string
      notSet: string
      customName: string
      platformName: string
      refreshIcon: string
      baseUrl: string
      relayHint: string
      draftDiscoverHint: string
      discoverModelsDone: string
      relayDetected: string
      relayDetectedNamed: string
      relayKindNewApi: string
      relayKindOneApi: string
      relayKindSub2api: string
      relayKindOpenaiCompatible: string
      apiKey: string
      formats: string
      capabilities: string
      familyAnthropic: string
      familyOpenai: string
      familyNewapi: string
      familyGoogle: string
      protocolOpenaiChatCompletion: string
      protocolOpenaiResponses: string
      taskChat: string
      taskImage: string
      taskVideo: string
      taskTts: string
      taskAsr: string
      defaultKeyName: string
      advanced: string
      claudeBaseUrl: string
      capabilitiesNeedKey: string
      capabilitiesPerKeyHint: string
      selectModel: string
      modelNone: string
      oneMillionHint: string
    }
    providerDialog: {
      addTitle: string
      addDescription: string
      editDescription: string
      name: string
      namePlaceholder: string
      keyName: string
      keyNamePlaceholder: string
      apiKey: string
      getApiKey: string
      envShow: string
      envHide: string
      advancedShow: string
      advancedHide: string
      baseUrl: string
      addVariable: string
      pasteEnv: string
      applyPaste: string
      environmentVariables: string
      modelMapping: string
      imageCapability: string
      mediaModels: string
      addModel: string
      modelIdPlaceholder: string
      modelNamePlaceholder: string
      bucketDefault: string
      bucketSubagent: string
      testing: string
      fetchingModels: string
      chatProbing: string
      connected: string
      connectedAll: string
      connectionFailed: string
      unknownError: string
      noAgentConfig: string
      test: string
      testEndpoint: string
      save: string
      delete: string
      sync: string
      syncTitle: string
      syncDescription: string
      syncNoChanges: string
      syncSupportedAgentsAdded: string
      syncExtraEnvSection: string
      syncModelEnvSection: string
      syncBaseUrlSection: string
      syncEmptyPlaceholder: string
      syncApply: string
      models: {
        title: string
        count: string
        search: string
        refresh: string
        released: string
        knowledge: string
        maxOutput: string
        priceIn: string
        priceOut: string
        empty: string
        noEntry: string
        copied: string
        all: string
        chat: string
        image: string
        video: string
        tts: string
        asr: string
        vision: string
        tools: string
        reasoning: string
        enabledGroup: string
        disabledGroup: string
        lockedHint: string
        addCustom: string
        customGroup: string
        usedFor: string
        add: string
        duplicate: string
        deleteCustom: string
        editModel: string
        discover: string
        discoverError: string
        discoverEmpty: string
        discoverTruncated: string
        discoveredGroup: string
        enableAllDiscovered: string
        disableAllDiscovered: string
      }
    }
    mcp: {
      title: string
      subtitle: string
      add: string
      refresh: string
      library: string
      statusDisabled: string
      statusConnecting: string
      statusFailed: string
      toolsCount_one: string
      toolsCount_other: string
      empty: string
      emptyHintClaude: string
      emptyHintCodex: string
      claudeAiTitle: string
      claudeAiFetching: string
      claudeAiEmpty: string
      tools: string
      noToolsConnected: string
      noToolsDisabled: string
      noToolsDisconnected: string
      form: {
        title: string
        paste: string
        pasteTooltip: string
        name: string
        namePlaceholder: string
        type: string
        command: string
        commandPlaceholder: string
        args: string
        argsPlaceholder: string
        env: string
        url: string
        urlPlaceholder: string
        headers: string
        scope: string
        scopeUser: string
        scopeProject: string
        verifying: string
        adding: string
        add: string
        verified: string
        verificationFailed: string
        clipboardInvalid: string
        clipboardFailed: string
        tabManual: string
        tabBundle: string
      }
      libraryView: {
        title: string
        empty: string
        added: string
        addCount: string
        adding: string
        deleteButton: string
        deleteTitle: string
        deleteDescription: string
        deleting: string
        delete: string
      }
      detail: {
        authTitle: string
        authDescription: string
        authorizing: string
        authorize: string
        configuration: string
        edit: string
        commandLabel: string
        argsLabel: string
        environmentLabel: string
        urlLabel: string
        headersLabel: string
        uninstallTitle: string
        uninstallDescription: string
        confirmQuestion: string
        confirm: string
        uninstall: string
        bundleBadge: string
        bundleReveal: string
      }
      bundle: {
        installButton: string
        dropToInstall: string
        dropZoneTitle: string
        dropZoneHint: string
        notMcpbFile: string
        installed: string
        dialogTitle: string
        dialogDescription: string
        readingBundle: string
        cannotRead: string
        warningHeader: string
        replaceExistingSameVersion: string
        replaceExistingDifferentVersion: string
        toolsSection: string
        promptsSection: string
        toolsGenerated: string
        scopeLabel: string
        scopeUser: string
        scopeProject: string
        scopeHint: string
        configurationSection: string
        sensitiveBadge: string
        requiredField: string
        cancel: string
        install: string
        installing: string
      }
    }
    plugins: {
      title: string
      subtitleClaude: string
      subtitleCodex: string
      tabMarketplace: string
      tabInstalled: string
      emptyMarketplace: string
      emptyMarketplaceHintClaude: string
      emptyMarketplaceHintCodex: string
      emptyInstalled: string
      emptyInstalledHintClaude: string
      emptyInstalledHintCodex: string
      updateAvailable: string
      updateAll: string
      updating: string
      update: string
      loading: string
      searchPlaceholder: string
      searchNoMatch: string
      marketplaceEmpty: string
      addMarketplace: string
      addMarketplaceTitle: string
      addMarketplaceDesc: string
      addMarketplaceSourceLabel: string
      addMarketplaceSourcePlaceholder: string
      addMarketplaceSourceHint: string
      addMarketplaceScopeLabel: string
      removeMarketplace: string
      removeMarketplaceTitle: string
      removeMarketplaceDesc: string
      add: string
      adding: string
      removing: string
      scope: {
        user: string
        project: string
      }
      marketplaceScope: {
        user: string
        project: string
        local: string
        official: string
      }
      detail: {
        apps: string
        needsAuth: string
        install: string
        skills: string
        disabled: string
        screenshots: string
        overview: string
        metadata: string
        capabilities: string
        mcpServers: string
        links: string
        website: string
        privacy: string
        terms: string
        starterPrompts: string
        noFiles: string
        selectResource: string
        emptyFolder: string
        referencedScripts: string
      }
      capability: {
        commands: string
        agents: string
        skills: string
        hooks: string
        mcp: string
        other: string
      }
    }
    hooks: {
      title: string
      subtitle: string
      add: string
      empty: string
      emptyHint: string
      applyNote: string
      entryCount_one: string
      entryCount_other: string
      deleteTitle: string
      deleteDescription: string
      scope: {
        user: string
        project: string
        local: string
      }
      types: {
        command: string
        prompt: string
        agent: string
        http: string
        mcp_tool: string
      }
      editor: {
        titleNew: string
        titleEdit: string
        subtitle: string
        advanced: string
        eventGroup: {
          common: string
          more: string
        }
        fields: {
          scope: string
          event: string
          matcher: string
          matcherHint: string
          type: string
          command: string
          shell: string
          shellAuto: string
          async: string
          asyncHint: string
          asyncRewake: string
          asyncRewakeHint: string
          prompt: string
          promptHint: string
          model: string
          url: string
          headers: string
          headersHint: string
          allowedEnvVars: string
          allowedEnvVarsHint: string
          mcpServer: string
          mcpTool: string
          mcpInput: string
          mcpInputHint: string
          ifHint: string
          timeout: string
          statusMessage: string
          once: string
          onceHint: string
        }
      }
      errors: {
        commandRequired: string
        promptRequired: string
        urlRequired: string
        mcpToolRequired: string
        invalidTimeout: string
        headersJson: string
        toolInputJson: string
      }
    }
    codexHooks: {
      title: string
      subtitle: string
      readOnlyNote: string
      empty: string
      emptyHint: string
      source: {
        user: string
        project: string
        managed: string
        plugin: string
        unknown: string
      }
    }
    schedule: {
      label: string
      simple: string
      advanced: string
      preset: {
        once: string
        hourly: string
        daily: string
        weekly: string
      }
      pickDate: string
      atMinute: string
      pastHour: string
      time: string
      cronExpression: string
      nextRuns: string
      days: {
        mon: string
        tue: string
        wed: string
        thu: string
        fri: string
        sat: string
        sun: string
      }
    }
    automation: {
      editTitle: string
      createTitle: string
      editDescription: string
      createDescription: string
      name: string
      namePlaceholder: string
      provider: string
      prompt: string
      promptPlaceholder: string
      enabled: string
      enabledOn: string
      enabledOff: string
      agentSettingsShow: string
      agentSettingsHide: string
      select: string
      defaultValue: string
      fullAccess: string
      readOnly: string
      approveForMe: string
      defaultDesc: string
      fullAccessDesc: string
      readOnlyDesc: string
      approveForMeDesc: string
      model: string
      effort: string
      permission: string
      sandbox: string
      reasoning: string
      save: string
      create: string
    }
    remote: {
      title: string
      subtitle: string
      enableLabel: string
      enableDescription: string
      preventSleepLabel: string
      preventSleepDescription: string
      pairNewDevice: string
      pairNewPhone: string
      pairNewDesktop: string
      pairTitle: string
      stepScan: string
      stepCode: string
      copyLink: string
      linkCopied: string
      codePrompt: string
      confirming: string
      confirm: string
      codeError: string
      sessionExpired: string
      alreadyPaired: string
      paired: string
      noPaired: string
      online: string
      lastSeen: string
      neverConnected: string
      remove: string
      customRelay: string
      deployCloudflare: string
      checking: string
      test: string
      relayConnected: string
      relayUnreachable: string
      relayHint: string
      statusRelay: string
      statusLan: string
      statusLanActive: string
      statusLanInactive: string
      statusRelayConnected: string
      statusRelayDisconnected: string
    }
    apps: {
      title: string
      subtitle: string
      loading: string
      empty: string
      emptyHint: string
      noTools: string
      toolCount_one: string
      toolCount_other: string
      sections: { personal: string; project: string }
      preapprovalTitle: string
      preapprovalDescription: string
      noAppTools: string
      permissions: string
      uninstallTitle: string
      uninstallDescription: string
      uninstallDevDescription: string
      confirmQuestion: string
      confirm: string
      uninstall: string
      uninstalled: string
      uninstallFailed: string
      authorBy: string
      readOnly: string
      readWrite: string
      network: string
      dropHint: {
        left: string
        right: string
        top: string
        bottom: string
        center: string
      }
    }
    devAppLibrary: {
      toggleButton: string
      title: string
      addNew: string
      loading: string
      empty: string
      emptyHint: string
      added: string
      addFailed: string
      installedHere: string
      missingBadge: string
      orphanBadge: string
      installScopeUser: string
      installScopeProject: string
      revealSource: string
      installTo: string
      scopeUser: string
      scopeProject: string
      scopeProjectNone: string
      installCount: string
      installing: string
      installedCount: string
      noProjectSelected: string
      removeButton: string
      removeTitle: string
      removeDescription: string
      removeCascadeLabel: string
      remove: string
      removing: string
      removedCount: string
    }
  }
  widget: {
    save: {
      title: string
      updateTitle: string
      description: string
      namePlaceholder: string
      descriptionPlaceholder: string
      scopeProject: string
      scopeUser: string
      scopeProjectHint: string
      scopeUserHint: string
      staticHint: string
      confirm: string
      saved: string
      failed: string
    }
  }
  tooltips: {
    toggleSidebar: string
    moveChatLeft: string
    moveChatRight: string
    toggleActivityPanel: string
    maximizeActivityPanel: string
    restoreActivityPanel: string
    toggleTerminal: string
    closeBrowser: string
    closeMiniApp: string
    returnToPanel: string
    expandToPlainText: string
    save: string
    newAutomation: string
    newSession: string
    folderNotFound: string
    rewind: string
    fork: string
    collapsePermission: string
    worktree: string
    local: string
    createWorktreeFrom: string
    mermaidPreview: string
    mermaidSource: string
    expand: string
    fastMode: string
    selectModel: string
    thinkingEffort: string
    effortFromEnv: string
    reasoningEffort: string
    exitPlanMode: string
    reload: string
    openDevTools: string
    devTools: string
    saveAsHtml: string
    copyPlan: string
    close: string
    fullscreen: string
    unsavedChanges: string
    maximize: string
    sessionGrid: string
  }
  usageGauge: {
    claudeTitle: string
    codexTitle: string
    windowFallback: string
    percentLeft: string
    resetsSoon: string
    resetsIn: string
    extraUsage: string
    creditBalance: string
    resetCredits: string
    resetCreditDefault: string
    resetCreditExpires: string
    resetNow: string
    resetting: string
    lifetimeTokens: string
    peakDaily: string
    streak: string
    updating: string
    updatedJustNow: string
    updatedMinutesAgo: string
    updatedHoursAgo: string
    updatedDaysAgo: string
    rateLimit: {
      approaching: string
      limited: string
      percentUsed: string
      resetsAt: string
    }
    toast: {
      reset: string
      nothingToReset: string
      noCredit: string
      alreadyRedeemed: string
      unknown: string
    }
  }
}

export const en: Messages = {
  activity: {
    launcher: {
      browser: 'Browser',
      terminal: 'Terminal',
    },
  },
  common: {
    cancel: 'Cancel',
    confirm: 'Confirm',
    create: 'Create',
    save: 'Save',
    saving: 'Saving...',
    delete: 'Delete',
    close: 'Close',
    loading: 'Loading...',
    systemDefault: 'Default',
    back: 'Back',
    retry: 'Retry',
    refresh: 'Refresh',
    continue: 'Continue',
    next: 'Next',
    terminal: 'Terminal',
    edit: 'Edit',
  },
  sidebar: {
    newSession: 'New Session',
    tabs: {
      sessions: 'Sessions',
      files: 'Files',
    },
    pinned: 'Pinned',
    drafts: {
      title: 'Drafts',
      untitled: 'Untitled Draft',
      justNow: 'just now',
      minutesAgo: '{{count}}m ago',
      hoursAgo: '{{count}}h ago',
      daysAgo: '{{count}}d ago',
      pendingSync: 'Pending Sync',
      pendingSyncHint: 'Saved on this computer; it will sync when the host reconnects.',
    },
    projects: 'Projects',
    thisMac: 'This Mac',
    thisPc: 'This PC',
    hostDisconnected: 'Host offline',
    hostConnectHint: 'Connect this host in Settings → Remote Control to browse its projects.',
    hostUpgrading: 'Upgrading {{label}} from SuperOne CLI {{remoteVersion}} to {{targetVersion}}…',
    hostUpgraded: '{{label}} upgraded to SuperOne CLI {{version}}',
    hostUpgradeFailed: 'Could not upgrade {{label}}: {{error}}',
    hostOutdatedManual:
      '{{label}} runs SuperOne CLI {{remoteVersion}}, older than this desktop ({{targetVersion}}). It was not paired over SSH, so upgrade it on the host with `npm install -g @super-one/cli@alpha` and restart the node.',
    addProject: {
      title: 'Add Project',
      description: 'on {{host}}',
      stepTitle: {
        source: 'Add Project',
        browse: 'Open or Create a Folder',
        github: 'Search GitHub',
        url: 'Enter a Git URL',
        destination: 'Choose Clone Location',
      },
      sources: {
        title: 'Sources',
        searchPlaceholder: 'Type a path, or pick a source...',
        local: { label: 'Local Folder', hint: 'Open or create a folder on this machine.' },
        github: {
          label: 'GitHub Repository',
          hint: 'Search by name, owner/repo, or paste a GitHub URL.',
        },
        url: { label: 'Git URL', hint: 'Clone from any git remote.' },
      },
      pathPlaceholderLocal: '~/Projects/',
      pathPlaceholderRemote: '/home/superone/',
      repoPlaceholderGithub: 'Name, owner/repo, or GitHub URL',
      repoPlaceholderUrl: 'https://github.com/owner/repo.git',
      destinationPlaceholder: 'Where should it be cloned?',
      repository: 'Repository',
      repoInvalidGithub: 'Type owner/ to search, or paste a GitHub URL.',
      repoInvalidUrl: 'Enter an https, ssh or git clone URL.',
      githubRepos: 'Repositories',
      githubYourRepos: 'Your Repositories',
      githubSearchResults: 'Search Results',
      githubSearching: 'Searching',
      githubNoRepos: 'No Repositories Matched.',
      githubNeedCli:
        'Install and sign in to GitHub CLI (gh) to list your repos, or type owner/repo.',
      githubPrivate: 'Private',
      clonesInto: 'Clones into {{path}}',
      cloning: 'Cloning...',
      willCreateDirectory: 'Will create {{path}}',
      createSection: 'Create',
      createDirectory: 'Create Directory',
      saveAsDefaultClonePath: 'Save as Default Clone Path',
      pathRequired: 'Enter a project path.',
      destinationExists:
        '"{{path}}" already exists. Pick another folder, or add that project instead of cloning.',
      browse: 'Browse',
      browseWith: 'Browse with',
      browseWithFinder: 'Browse with Finder',
      browseWithExplorer: 'Browse with File Explorer',
      directories: 'Directories',
      noDirectories: 'No directories here.',
      actions: {
        // Lowercase: also used as the footer ↵ shortcut label.
        select: 'select',
        continue: 'continue',
        add: 'add',
        clone: 'clone',
        open: 'open',
        create: 'create',
      },
      hintTab: 'autocomplete',
      hintNav: 'navigate',
      hintBack: 'back',
    },
    sort: {
      title: 'Sort Projects',
      recent: 'Recent Activity',
      added: 'Date Added',
    },
    empty: 'No projects yet',
    noFiles: 'No files',
    search: {
      placeholder: 'Search files...',
      noResults: 'No matching files',
    },
    settings: 'Settings',
    remote: {
      connected: 'Connected',
      disconnected: 'Disconnected',
      deviceConnectedToast: '{{name}} connected',
      lanActive: 'Active',
      lanInactive: 'Inactive',
      upload: {
        receiving: 'Receiving file',
        completed: 'File received',
        failed: 'Transfer failed',
        route: '{{device}} → {{dir}}',
      },
    },
    deleteSession: {
      title: 'Delete Session?',
      descriptionPrefix: 'will be removed from SuperOne. You can still access it via',
      descriptionSuffix: ':',
      dontAsk: "Don't ask again",
      delete: 'Delete',
    },
    removeProject: {
      title: 'Remove Project?',
      description: 'and all its chat sessions will be removed from SuperOne. Your project files will not be affected.',
      remove: 'Remove',
    },
    renameSession: {
      title: 'Rename Session',
    },
    pending: {
      allowTool: 'Allow {{tool}}?',
      allowApp: 'Allow {{app}}?',
      allowComputerUse: 'Allow computer use?',
      approveVideoGen: 'Approve video generation?',
      confirmNamed: 'Confirm {{name}}?',
      confirmSettings: 'Confirm {{count}} settings?',
      confirmConfig: 'Confirm config change?',
      waitingInput: 'Waiting for input',
      reviewPlan: 'Review plan',
      collabFallback: 'Approve agent launch?',
      collabOne: 'Launch {{name}}?',
      collabOneWithRole: 'Launch {{name}} · {{role}}?',
      collabTwo: 'Launch {{a}} + {{b}}?',
      collabMany: 'Launch {{count}} agents?',
      agentLaunch: 'agent launch',
      toolFallback: 'tool',
    },
    contextMenu: {
      sessionHistory: 'Session History',
      removeProject: 'Remove Project',
      automations: 'Automations',
      miniApps: 'Mini apps',
      workerUptimeS: '{{s}}s',
      workerUptimeMS: '{{m}}m {{s}}s',
      workerUptimeHM: '{{h}}h {{m}}m',
      openMiniApp: 'Open',
      stopWorker: 'Stop',
      runNow: 'Run Now',
      edit: 'Edit',
      delete: 'Delete',
      noSessions: 'No sessions',
      showMore: 'Show more',
      showLess: 'Show less',
      expandChildren: 'Expand sub-sessions',
      collapseChildren: 'Collapse sub-sessions',
      searchSessions: 'Search sessions…',
      rename: 'Rename Session',
      renameFile: 'Rename',
      pin: 'Pin Session',
      unpin: 'Unpin Session',
      hide: 'Hide Session',
      unhide: 'Unhide Session',
      tags: 'Tags',
      noTags: 'No tags',
      tagCopiedToast: 'Tag copied',
      copySessionId: 'Copy Session ID',
      copyWorkingDirectory: 'Copy Working Directory',
      openFolder: 'Open Folder',
      openInMiniWindow: 'Open in Mini Window',
      dragToMiniWindow: 'Release to open as mini window',
      forkToWorktree: 'Fork to New Worktree',
      forkToLocal: 'Fork to Same Worktree',
      forkToSameWorktree: 'Fork to Same Worktree',
      forkingToast: 'Forking session…',
      forkedToast: 'Forked to a new worktree',
      forkedLocalToast: 'Forked in the same worktree',
      sessionIdCopiedToast: 'Session ID Copied',
      sessionIdNotReadyToast: 'Session ID not ready — copied internal id',
      workingDirCopiedToast: 'Working Directory Copied',
      addToChat: 'Add to Chat',
      copyPath: 'Copy Path',
      copyRelativePath: 'Copy Relative Path',
      previewInBrowser: 'Preview in Browser',
    },
    appDrawer: {
      buildYourOwn: 'Build Your Own',
      marketplace: 'Marketplace',
      buildAppPrompt: 'Help me build a mini app for SuperOne. First call `read_manual({ domain: "miniapp", topic: "overview" })` (via the `superone` MCP server) to load the development guide, then guide me through the process step by step.',
    },
  },
  shell: {
    startup: {
      title: 'Super One',
      tagline: 'The one, the only!',
      openProject: 'Open Project',
    },
    onboarding: {
      welcome: {
        title: 'Welcome to Super One',
        tagline: 'The desktop home for your coding agents.',
        themeLabel: 'Appearance',
      },
      discover: {
        title: 'Enable Harnesses You Like',
        subtitle:
          'We scanned your machine for supported CLIs. SuperOne still installs its own managed runtimes for Claude and Codex so versions stay consistent.',
        scanning: 'Scanning for installed CLIs…',
        rescan: 'Scan again',
        detected: 'Detected on this computer',
        notFound: 'Not found',
        willDownload: 'Will download SuperOne runtime',
        useManaged: 'Uses SuperOne managed runtime',
        enableSelected: 'Enable selected ({{count}})',
        skip: 'Skip for now',
        enabling: 'Enabling…',
        enableFailed: 'Could not enable {{id}}: {{message}}',
        ids: {
          claude: 'Claude Code',
          codex: 'Codex',
          opencode: 'OpenCode',
          cursor: 'Cursor',
          'acp-grok': 'Grok',
        },
      },
    },
    harnessAlign: {
      title: 'Align Harness Version',
      subtitle: 'Installing SuperOne-managed runtimes for your enabled harnesses…',
      checking: 'Checking installed versions…',
      failed: 'Could not align harness runtimes.',
    },
    setup: {
      required: {
        title: 'Setup Required',
        description: 'Claude Code is required to power this app. Install it to continue.',
      },
      installing: {
        title: 'Installing Claude Code...',
        description: "This may take a minute or two. Please don't close the app.",
      },
      success: {
        title: 'Installation Complete',
        description: 'Claude Code is ready to use.',
      },
      error: {
        title: 'Installation Failed',
        description: 'Something went wrong. Check the output below and try again.',
      },
      install: 'Install Claude Code',
    },
    update: {
      checking: 'Checking for updates...',
      available: 'Update',
      availableHint: 'Update {{version}} available — click to download',
      preparing: 'Preparing update {{version}}...',
      preparingShort: 'Preparing',
      upToDate: "You're up to date",
      downloading: 'Downloading {{version}}...',
      downloadingWithProgress: 'Downloading {{version}}... {{progress}}%',
      downloadingHarnessWithProgress:
        'Preparing harnesses for {{version}}... {{progress}}% ({{harness}})',
      harnessFailed: 'Could not download harness runtimes for this update.',
      harnessError: 'Harness prep failed for {{version}}. Click to retry.\n{{message}}',
      retryHarness: 'Retry',
      ready: 'v{{version}} is ready',
      restart: 'Restart',
    },
    mosaic: {
      noSpace: 'Not enough space',
    },
  },
  settings: {
    layout: {
      tabs: {
        general: 'General',
        appearance: 'Appearance',
        browser: 'Browser',
        computerUse: 'Computer Use',
        apps: 'Mini Apps',
        remote: 'Remote Control',
        usage: 'Usage Stats',
        mediaGen: 'Image Gen',
        providers: 'AI Provider',
        harnesses: 'Harnesses',
        agents: 'Subagents',
        skills: 'Skills',
        mcp: 'MCP Servers',
        hooks: 'Hooks',
        plugins: 'Plugins',
        preferences: 'Preferences',
        account: 'Account',
        cloud: 'Cloud',
        models: 'Models',
      },
      providers: {
        claude: 'Claude Code',
        codex: 'Codex',
      },
    },
    harnesses: {
      title: 'Harnesses',
      subtitle: 'Enable agent runtimes on this Mac. Managed harnesses download on demand.',
      hint: 'Only enabled and ready harnesses appear in new-session pickers.',
      loading: 'Loading harness catalog…',
      enable: 'Enable',
      disable: 'Disable',
      enabled: 'Enabled {{id}}',
      disabled: 'Disabled {{id}}',
      installing: 'Downloading runtime…',
      progress: '{{received}} / {{total}} ({{pct}}%)',
      needsAuth: 'Sign in required before this harness can run turns.',
      sourceManaged: 'Managed download',
      sourceExternal: 'External (PATH / config)',
      groupEnabled: 'Enabled',
      groupDisabled: 'Disabled',
      dragHandle: 'Drag to reorder',
      selectHint: 'Select a harness to manage',
      experimentalBadge: 'Experimental',
      experimentalAcpHint:
        'This ACP agent is experimental. Enabling it only shows it in session pickers — install the agent binary separately if needed.',
      configSection: 'Configuration',
      fields: {
        source: 'Source',
        version: 'Version',
        command: 'Command',
      },
      desc: {
        claude: 'Claude Code runtime (Agent SDK binary). Downloads on enable when not bundled.',
        codex: 'OpenAI Codex app-server binary. Downloads on enable when not bundled.',
        opencode: 'OpenCode CLI / server. External runtime resolved from PATH or config.',
        cursor: 'Experimental Cursor Agent SDK harness. Managed in-process runtime; requires a Cursor User API Key.',
        acpGrok: 'Grok via the Agent Client Protocol.',
        experimentalAcp: 'Optional ACP agent detected on this machine.',
      },
      ids: {
        claude: 'Claude Code',
        codex: 'Codex',
        opencode: 'OpenCode',
        cursor: 'Cursor',
        'acp-grok': 'Grok (ACP)',
      },
      cursor: {
        apiKeyTitle: 'Cursor User API Key',
        apiKeyDescription: 'Create a key at the Cursor dashboard. Desktop login alone is not enough for the SDK.',
        apiKeySaved: 'Cursor API key saved',
        apiKeyConfigured: 'API key saved ({{name}})',
        apiKeyConfiguredAnonymous: 'on file',
        apiKeyMissing: 'No API key saved yet',
        apiKeyReplacePlaceholder: 'Paste a new key to replace…',
        saveKey: 'Save',
        replaceKey: 'Replace',
        cloudTitle: 'Cursor Cloud Agents',
        cloudDescription: 'Secondary runtime (bc-*). Local project chat remains the default when off.',
        cloudEnabled: 'Cursor cloud runtime enabled',
        localEnabled: 'Cursor local runtime enabled',
        autoCreatePr: 'Auto-create PR when cloud agent finishes',
        workOnCurrentBranch: 'Work on current branch',
        saveRuntime: 'Save Cursor runtime',
        modelsTitle: 'Models',
        modelsDescription: 'Choose which Cursor models appear in the chat model picker.',
        modelsEmpty: 'No models loaded yet. Save an API key and refresh the harness.',
        modelsEnableAll: 'Enable all',
        modelsDisableAll: 'Disable all',
        settingSourcesTitle: 'Local settings sources',
        settingSourcesDescription:
          'Which on-disk Cursor layers local agents load (.cursor/ rules, hooks, MCP). Cloud always loads project/team/plugins.',
        settingSourceProject: 'Project (.cursor/)',
        settingSourceUser: 'User (~/.cursor/)',
        settingSourcePlugins: 'Plugins',
        envVarsTitle: 'Cloud env vars',
        envVarsDescription: 'KEY=value lines injected into cloud agent shells (encrypted at rest by Cursor). Names cannot start with CURSOR_.',
        envVarsPlaceholder: 'STAGING_API_TOKEN=…',
        forceRecoverTitle: 'Force recover stuck local run',
        forceRecoverDescription:
          'Expires a wedged local Cursor run (AgentBusyError) so the active session can send again. Requires an open Cursor session.',
        forceRecoverAction: 'Force recover',
        forceRecoverNeedSession: 'Open a Cursor chat session first.',
        forceRecoverLocalOnly: 'Force recover is local-only. Turn off Cloud Agents or cancel the cloud run instead.',
        forceRecoverDone: 'Force recover sent',
        cloudAgentsTitle: 'Cloud agents',
        cloudAgentsEmpty: 'No cloud agents yet.',
        cloudAgentsRefresh: 'Refresh',
        cloudAgentsArchive: 'Archive',
        cloudAgentsDelete: 'Delete',
        browserLogin: 'Log in with browser',
        browserLoginDescription: 'Mint a User API Key via Cursor browser login (SDK). The key is stored in SuperOne.',
        browserLoginDone: 'Logged in{{email}}',
        browserLogout: 'Clear SDK login store',
        toolPresetTitle: 'Local tool restrictions',
        toolPresetDescription: 'Limit built-in tools for local agents (SDK tools/disallowedTools). Cloud ignores this.',
        toolPresetDefault: 'Default (full)',
        toolPresetReadonly: 'Read-only',
        toolPresetNoShell: 'No shell',
        usageTitle: 'Agent usage',
        usageRefresh: 'Load usage',
        usageEmpty: 'Enter a Cursor agent id (local or bc-*) to load billed usage.',
        usageTokens: 'Tokens: in {{input}} · out {{output}} · total {{total}}',
        usageCost: 'Cost: {{charged}}¢ charged ({{raw}}¢ raw)',
      },
      states: {
        disabled: 'Disabled',
        missing: 'Missing',
        installing: 'Installing',
        needs_auth: 'Needs auth',
        ready: 'Ready',
        incompatible: 'Incompatible',
        error: 'Error',
      },
    },
    remote: {
      pageTitle: 'Remote Control',
      pageSubtitle:
        'Let phones control this computer, or connect SuperOne to other machines as execution environments.',
      tabs: {
        thisComputer: 'Control This Computer',
        thisMac: 'Control This Mac',
        otherDevices: 'Control Other Devices',
      },
      thisDevice: {
        mobile: {
          title: 'Mobile',
          description: 'Phones paired to monitor and control this SuperOne.',
          empty: 'No phones paired yet.',
        },
        desktop: {
          title: 'Desktop',
          description: 'Other SuperOne desktops allowed to control this computer.',
          empty: 'No desktop clients paired yet.',
        },
      },
      otherDevices: {
        title: 'Other devices',
        subtitle:
          'Run projects, terminals, and agents on remote machines. They keep running after you disconnect.',
      },
      channels: {
        addDevice: 'Add Device',
        empty: 'No devices yet',
        desktop: {
          title: 'Desktop',
          description: 'Connect to another SuperOne desktop over the network.',
        },
        ssh: {
          title: 'SSH',
          description: 'Bootstrap or pair a headless superone node over SSH.',
        },
        tailscale: {
          title: 'Tailscale',
          description: 'Reach a node on your tailnet without opening ports.',
        },
        localLab: {
          title: 'Local lab',
          description:
            'Dev-only: pair to a host-process superone node on loopback (remote protocol, host credentials).',
          connect: 'Connect lab',
          reconnect: 'Reconnect lab',
          offline: 'Lab offline',
          online: 'Lab online',
          startHint: 'Start the lab first: {{cmd}}',
          connectSuccess: 'Connected to local lab',
          connectSuccessExisting: 'Reconnected to local lab',
          refreshStatus: 'Refresh',
        },
      },
    },
    environments: {
      title: 'Execution Environments',
      subtitle:
        'Each environment is a place where SuperOne runs projects, terminals, and agents. Remote nodes keep running after you disconnect.',
      connect: 'Connect',
      disconnect: 'Disconnect',
      forget: 'Remove',
      forgetConfirm:
        'Remove "{{label}}" from this computer? The remote service keeps running; only local credentials are erased.',
      addSuccess: 'Environment connected',
      credentialInMemoryOnly:
        'OS secure storage is unavailable, so this credential is kept in memory only and will be lost when SuperOne quits.',
      noSessionsCapability:
        'This node does not advertise agent sessions yet. Terminal and workspace operations still work.',
      nodeOutdated:
        'This node runs SuperOne CLI {{remoteVersion}}; this desktop ships {{targetVersion}}. Older nodes can report stale model catalogs and fail to run turns.',
      nodeOutdatedManual:
        'Upgrade it on the host with `npm install -g @super-one/cli@alpha`, then restart the node.',
      upgradeNode: 'Upgrade Node',
      upgradingNode: 'Upgrading node…',
      upgradeNodeSuccess: 'Node upgraded to {{version}}',
      harness: {
        title: 'Harnesses',
        loading: 'Loading harnesses…',
        empty: 'No harness catalog on this node.',
        enable: 'Enable',
        disable: 'Disable',
        enabled: 'Enabled {{id}}',
        disabled: 'Disabled {{id}}',
        needsAuth: 'sign-in required',
        ids: {
          claude: 'Claude',
          codex: 'Codex',
          opencode: 'OpenCode',
          cursor: 'Cursor',
          'acp-grok': 'Grok (ACP)',
        },
      },
      state: {
        available: 'Not Connected',
        connecting: 'Connecting',
        synchronizing: 'Syncing',
        connected: 'Connected',
        disconnected: 'Disconnected',
        backoff: 'Retrying',
        blocked: 'Blocked',
      },
      blockReason: {
        auth: 'Authentication failed',
        protocol_incompatible: 'Incompatible protocol version',
        revoked: 'Credential revoked',
        invalid_config: 'Invalid configuration',
        identity_conflict: 'Node identity mismatch',
        user: 'Disconnected by user',
      },
      add: {
        trigger: 'Add Environment',
        title: 'Add Remote Environment',
        description:
          'Bootstrap a remote node over SSH. Pairing runs automatically during install; afterward the desktop reconnects with stored credentials.',
        titleSsh: 'Add Device via SSH',
        descriptionSsh:
          'Pick a Host from your local SSH config, or add a new host manually.',
        sshTab: 'Over SSH',
        manualTab: 'Manual',
        knownHostsTab: 'Known Hosts',
        addNewHostTab: 'Add New Host',
        sshHostsLabel: 'SSH Host',
        sshHostsHint:
          'Hosts from your local ~/.ssh/config. System OpenSSH resolves User, Port, and keys.',
        sshHostsEmpty:
          'No Host entries in ~/.ssh/config. Switch to Add New Host to enter a destination.',
        sshPickRequired: 'Select an SSH host from the list.',
        sshManualOption: 'Enter manually…',
        manualSshSection: 'SSH connection',
        destination: 'SSH Destination',
        destinationHint: 'user@host, or a Host alias from ~/.ssh/config.',
        autoInstallHint:
          'If superone is missing, the desktop installs @super-one/cli from npm over SSH (pinned version). Key-based SSH or ssh-agent is required.',
        uploadInstallHint:
          'Development mode: upload a local superone dist tarball over SSH instead of using npm.',
        useLocalUpload: 'Install From Local',
        useLocalUploadHint:
          'Requires apps/cli/dist (or a packaged resources/superone-dist) built for the remote OS/arch.',
        advanced: 'Advanced',
        autoDetected: 'Auto-detect / install',
        remoteExec: 'Remote Executable',
        remoteExecHint:
          'Optional. Absolute path to superone on the remote host. Leave blank to probe PATH and install if missing.',
        remotePort: 'Node Port',
        sshPort: 'SSH Port',
        identityFile: 'Identity File',
        identityFileHint:
          'Optional. Only needed when the key is not in ssh-agent or ~/.ssh/config.',
        label: 'Label',
        progress: {
          probing: 'Probing remote host…',
          npm: 'Installing @super-one/cli…',
          upload: 'Uploading package…',
          verify: 'Verifying package…',
          extract: 'Extracting…',
          activate: 'Activating install…',
          starting: 'Starting node…',
          pairing: 'Pairing…',
        },
        submit: 'Connect',
      },
    },
    appearance: {
      title: 'Appearance',
      subtitle: 'Customize the look and feel of SuperOne',
      interface: 'Interface',
      theme: {
        label: 'Theme',
        system: 'System',
        light: 'Light',
        dark: 'Dark',
      },
    },
    browser: {
      title: 'Browser',
      subtitle: 'Configure the built-in browser and its automation tools',
      surface: {
        label: 'Compact tool surface',
        description: 'Advertise 8 phase tools (tabs / snapshot / query / act / wait / evaluate / network / action) instead of the classic per-verb list. Takes effect in new chat sessions. Turn off to restore the classic list.',
        compact: 'Compact (8 tools)',
        legacy: 'Classic (30 tools)',
      },
      cdp: {
        label: 'Chrome DevTools Protocol (CDP)',
        description: 'Routes the built-in browser tools to their CDP implementation, and unlocks the file-upload tool.',
      },
      experimental: {
        title: 'Experimental Tools',
        description: 'These browser tools are experimental and off by default. Enable each individually — when off, the tool is not exposed to the agent at all.',
        requiresCdp: 'Requires CDP to be enabled.',
        cookies: {
          label: 'Cookie Reading',
          description: 'Let the agent read the page cookies, including httpOnly session cookies. Values are truncated, but this still exposes login credentials to the model.',
        },
        emulate: {
          label: 'Device Emulation',
          description: 'Let the agent override viewport size, device scale, mobile mode, user agent, color scheme, timezone, locale, and geolocation for the page. Overrides persist until reset or the tab is closed.',
        },
        mock: {
          label: 'Network Mocking',
          description: 'Let the agent intercept and modify requests and responses — including login credentials and cookies. Only enable in trusted scenarios; misuse can hang pages (reload the tab to recover).',
        },
      },
    },
    computerUse: {
      title: 'Computer Use',
      subtitle: 'Let the agent observe and control native desktop apps (fallback when browser/Bash tools are not enough)',
      enable: {
        label: 'Enable Computer Use',
        description: 'Expose computer_* tools to the agent. Off by default. Requires the SuperOne Computer Use helper app and macOS Accessibility + Screen Recording permissions.',
      },
      allowAll: {
        label: 'Allow All Apps',
        description: 'Skip per-app grants and capture the full desktop. Any app can be observed and controlled while this is on.',
      },
      alwaysAllow: {
        title: 'Always Allow',
        description: 'These apps can be used by Computer Use without a prompt. Session-only grants from chat do not appear here.',
        add: 'Add App',
        empty: 'No always-allowed apps yet. Add from running apps, or choose Always Allow when the agent asks.',
        remove: 'Remove {{app}}',
        searchPlaceholder: 'Filter running apps…',
        loadingApps: 'Loading running apps…',
        emptyRunning: 'No matching running apps. Launch the app first, then add it here.',
      },
      permissions: {
        title: 'macOS Permissions',
        description: 'First enable walks through Accessibility then Screen Recording. You can also request each permission again later.',
        button: 'Request Permissions…',
        buttonGranted: 'Granted',
        requestAccessibility: 'Request…',
        requestScreenRecording: 'Request…',
        opening: 'Requesting…',
        checking: 'Checking…',
        requested: 'Permission guide opened. Drag the floating helper icon into the Privacy list.',
        alreadyGranted: 'Accessibility and Screen Recording are already granted.',
        accessibility: 'Accessibility',
        screenRecording: 'Screen Recording',
        accessibilityGrantedShort: 'Accessibility · granted',
        accessibilityMissing: 'Accessibility · missing',
        screenRecordingGrantedShort: 'Screen Recording · granted',
        screenRecordingMissing: 'Screen Recording · missing',
        helperName: 'SuperOne Computer Use',
        dragHint: 'Drag into System Settings → Privacy',
        stepAccessibility: 'Grant Accessibility',
        stepScreenRecording: 'Grant Screen Recording',
        dragHintAccessibility: 'Drag this icon into the Accessibility list',
        dragHintScreenRecording: 'Drag this icon into the Screen Recording list',
        accessibilityGranted: 'Accessibility granted',
        accessibilityGrantedHint: 'Step 1 is done. Continue to grant Screen Recording.',
        continueToScreenRecording: 'Continue to Screen Recording',
        screenRecordingGranted: 'Screen Recording granted',
        allGrantedHint: 'Both permissions are ready. Computer Use can run.',
        done: 'Done',
        recheck: 'Recheck Permission',
        rechecking: 'Rechecking…',
        recheckStillMissing: 'Still not granted. Enable {{helperName}} in System Settings, then recheck.',
      },
    },
    general: {
      title: 'General',
      subtitle: 'Configure SuperOne application behavior',
      privacy: 'Privacy',
      appearance: 'Appearance',
      updates: 'Updates',
      languageRegion: 'Language & Region',
      terminal: 'Terminal',
      terminalTheme: {
        light: 'Light Color Scheme',
        dark: 'Dark Color Scheme',
      },
      terminalFontSize: {
        label: 'Font Size',
        description: 'Font size for the integrated terminal.',
      },
      terminalFont: {
        label: 'Terminal Font',
        description: 'Monospace font for the integrated terminal, from fonts installed on your system.',
      },
      mermaid: 'Mermaid Diagrams',
      mermaidTheme: {
        light: 'Light Theme',
        dark: 'Dark Theme',
      },
      uiFont: {
        label: 'Interface Font',
        description: 'Font for the app interface, from fonts installed on your system.',
      },
      font: {
        systemDefault: 'System Default',
      },
      analytics: {
        label: 'Usage Analytics',
        description: 'Send anonymous usage data to help improve SuperOne. No personal data or conversation content is collected.',
        enabled: 'Analytics enabled',
        disabled: 'Analytics disabled',
      },
      media: 'Media',
      imageProvider: {
        label: 'Image Provider',
        description: 'Which provider generates images. Add keys and enable image models in Providers.',
        auto: 'Auto (First Usable)',
      },
      videoProvider: {
        label: 'Video Provider',
        description: 'Which provider generates videos. Add keys and enable video models in Providers.',
        auto: 'Auto (First Usable)',
      },
      harness: 'Agents',
      defaultHarness: {
        label: 'Default Harness',
        description: 'Primary agent on the new-chat tabs. Auto ranks by recent parent sessions (collaboration children excluded).',
        auto: 'Auto',
        updated: 'Default harness updated.',
      },
      secondaryHarness: {
        label: 'Secondary Harness',
        description: 'Second agent on the new-chat tabs. Auto uses the next rank after the default.',
        auto: 'Auto',
        updated: 'Secondary harness updated.',
        duplicate: 'Secondary harness must differ from the default.',
      },
      harnessOptions: {
        claude: 'Claude Code',
        codex: 'Codex',
        opencode: 'OpenCode',
      },
      experimental: 'Experimental',
      experimentalAgents: {
        label: 'Experimental Agents',
        description: 'Show experimental agents including OpenCode and non-Grok ACP agents. Behavior may change.',
        enabled: 'Experimental agents enabled',
        disabled: 'Experimental agents disabled',
      },
      experimentalClaudeOpenAiChat: {
        label: 'Claude Chat Completions Bridge',
        description: 'Allow Claude Code to use providers that only support OpenAI Chat Completions through SuperOne\'s local protocol proxy.',
        enabled: 'Claude Chat Completions bridge enabled',
        disabled: 'Claude Chat Completions bridge disabled',
      },
      experimentalRemoteNodes: {
        label: 'Remote Nodes',
        description: 'Connect SuperOne to remote execution environments (Linux nodes / labs), pick them in the sidebar, and run agent sessions on that machine. Experimental — install, pairing, and harness setup may change.',
        enabled: 'Remote nodes enabled',
        disabled: 'Remote nodes disabled',
      },
      autoExpandFileDiffs: {
        label: 'Auto-Expand File Diffs',
        description: 'Automatically expand Edit, Write, and FileChange tools while streaming. When off, only the header with line counts is shown until you expand.',
      },
      detailChatMode: {
        label: 'Detail Mode',
        description: 'Show the full process for each completed turn (tools, reasoning, intermediate steps). When off, only the final conclusion is shown and the process is collapsed under a disclosure.',
      },
      crispText: {
        label: 'Crisp Text',
        description: 'Use grayscale font smoothing so text renders thinner and sharper. macOS only.',
      },
      liquidGlass: {
        label: 'Glass Theme',
        description: 'Make window surfaces translucent to reveal the native macOS glass material behind them. macOS only.',
      },
      language: {
        label: 'Language',
        description: 'Interface language for SuperOne. Takes effect immediately.',
        system: 'Follow System',
        english: 'English',
        chinese: '中文',
        updated: 'Language updated',
      },
      appIcon: {
        label: 'App Icon',
        description: 'Use a custom icon for the Dock and taskbar. The icon shown in Launchpad updates after a restart.',
        choose: 'Choose…',
        reset: 'Reset to Default',
        updated: 'App icon updated',
        resetDone: 'App icon reset to default',
      },
      updateChannel: {
        label: 'Update Channel',
        description: 'Choose which release track receives auto-updates. Switching to a more stable channel may roll the app back to that channel’s latest build.',
        stable: 'Stable',
        beta: 'Beta',
        alpha: 'Alpha',
        stableDescription: 'Production releases only.',
        betaDescription: 'Beta plus stable releases.',
        alphaDescription: 'Earliest builds — alpha, beta, and stable.',
        updated: 'Update channel changed',
      },
      checkUpdates: {
        label: 'Check for Updates',
        description: 'SuperOne checks once on launch. Currently on v{{version}}.',
        action: 'Check Now',
        failed: 'Update check failed',
      },
    },
    preferences: {
      title: 'Preferences',
      claudeSubtitle: 'Configure Claude Code behavior',
      codexSubtitle: 'Configure Codex defaults for new sessions',
      import: {
        section: 'Migration',
        label: 'Import from Other Agents',
        description: 'Detect and import AGENTS.md, MCP servers, skills, and more from other AI agents.',
        detect: 'Detect',
        detecting: 'Detecting…',
        none: 'No importable configuration found',
        dialogTitle: 'Import Agent Configuration',
        dialogDescription: 'Found {{count}} item(s) to import into Codex.',
        confirm: 'Import',
        importing: 'Importing…',
        done: 'Imported {{success}} item(s), {{failure}} failed',
        error: 'Import failed',
      },
      sections: { project: 'Project Settings', user: 'User Settings' },
      projectEmptyCodex: 'Codex has no project-level preferences. Migration and defaults live under User.',
      defaultProvider: {
        label: 'Default Provider',
        description: 'Which API provider new sessions use by default. Switch per chat via /provider.',
      },
      outputStyle: {
        label: 'Output Style',
        description: 'Controls how Claude formats responses - tone, structure, and level of detail.',
        defaultName: 'Default',
        updated: 'Output style updated',
      },
      permissionMode: {
        label: 'Permission Mode',
        description: 'Default permission mode when starting a new session.',
        updated: 'Default permission mode updated',
      },
      sandbox: {
        label: 'Sandbox',
        description: 'Default sandbox mode when starting a new session.',
        menuTitle: 'Sandbox Mode',
        updated: 'Default sandbox mode updated',
        statusUnsupported: 'Sandbox is not supported on this platform',
        statusReady: 'Sandbox dependencies are ready',
        statusMissing: 'Missing dependencies: {{missing}}',
        statusNotProbed: 'Sandbox dependencies not checked yet',
        installHintTitle: 'Install Command',
        probeNow: 'Check Now',
        reProbe: 'Re-Check',
      },
      defaultModel: {
        label: 'Default Model',
        claudeDescription: 'Applied to sessions that have not picked a model.',
        codexDescription: 'Applied to new Codex sessions inside SuperOne. This does not modify local Codex settings.',
        loading: 'Loading models...',
        empty: 'No models available',
        emptyNoProject: 'Open a project to load models',
        claudeUpdated: 'Default Claude model updated',
        claudeSystemDefault: 'Using system default Claude model',
        codexUpdated: 'Default Codex model updated',
        codexSystemDefault: 'Using system default Codex model',
      },
      effort: {
        label: 'Default Thinking Effort',
        description: 'Applied when the selected default model supports effort selection.',
        chooseModel: 'Choose a default model first',
        unsupported: 'This model does not expose effort options',
        updated: 'Default thinking effort updated',
        systemDefault: 'Using system default thinking effort',
        levels: {
          low: 'Low',
          medium: 'Medium',
          high: 'High',
          xhigh: 'Extra High',
          max: 'Max',
        },
      },
      reasoningEffort: {
        label: 'Default Reasoning Effort',
        description: 'Applied when the selected default model supports reasoning effort selection.',
        updated: 'Default reasoning effort updated',
        systemDefault: 'Using system default reasoning effort',
      },
      askPreviewFormat: {
        label: 'Question Preview Format',
        description: 'Format Claude uses for option previews in the "Ask user a question" tool. HTML renders rich previews; Markdown renders plain text.',
        updated: 'Question preview format updated',
        options: { markdown: 'Markdown', html: 'HTML' },
      },
    },
    usage: {
      title: 'Usage Statistics',
      backfilling: 'Generating statistics from history sessions...',
      presets: {
        today: 'Today',
        '7d': 'Last 7 Days',
        '30d': 'Last 30 Days',
        '90d': 'Last 90 Days',
        all: 'All Time',
      },
      harness: {
        all: 'All',
        claude: 'Claude',
        codex: 'Codex',
        grok: 'Grok',
        cursor: 'Cursor',
        opencode: 'OpenCode',
      },
      summary: {
        totalTokens: 'Total Tokens',
        estimatedCost: 'Est. Cost',
        estimatedCostHint: 'Raw API Cost',
        unpricedHint: '{{count}} models lack list prices',
        sessions: 'Sessions',
        messages: 'Messages',
      },
      daily: {
        titleByHarness: 'Daily Usage (by Harness)',
        titleByTokenType: 'Daily Usage (by Token Type)',
        titleToday: "Today's Usage by Model",
        titleHeatmap: 'Activity Heatmap',
        empty: 'No data in the selected range',
      },
      heatmap: {
        less: 'Less',
        more: 'More',
        tokens: 'tokens',
        noActivity: 'No activity',
      },
      tokenTypes: {
        input: 'Input',
        output: 'Output',
        cacheRead: 'Cache Read',
        cacheCreation: 'Cache Creation',
      },
      tooltip: {
        total: 'Total',
        avg: 'avg',
      },
      byModel: {
        title: 'By Model',
        empty: 'No data',
        harness: 'Harness',
        model: 'Model',
        total: 'Total',
        cost: 'Est. Cost',
        unpriced: '—',
        input: 'Input',
        output: 'Output',
        cacheRead: 'Cache Read',
        cacheCreation: 'Cache Creation',
      },
    },
  },
  chat: {
    compactMode: {
      detail: 'Detail',
      toolCalls: '{{count}} tool calls',
      filesChanged: '{{count}} files changed',
    },
    placeholder: {
      addInstructions: 'Add instructions...',
      debugBug: 'describe the bug…',
      codexPlan: "Let's make a plan! What's in your mind?",
      codexReject: 'Tell Codex what to do differently',
      codexAsk: 'Ask Codex anything, @ for files & mini-apps, / for commands and skills',
      claudePlan: "Let's make a plan! What's in your mind?",
      claudeAsk: 'Ask Claude anything, @ for files, agents & mini-apps, / for commands and skills',
      openCodePlan: "Let's make a plan! What's in your mind?",
      openCodeAsk: 'Ask OpenCode anything, @ for files & mini-apps, / for commands and skills',
      cursorPlan: "Let's make a plan! What's in your mind?",
      cursorAsk: 'Ask Cursor anything, @ for files & mini-apps, / for commands and skills',
      acpPlan: "Let's make a plan with {{agent}}! What's in your mind?",
      acpAsk: 'Ask {{agent}} anything, @ for files & mini-apps, / for slash commands',
    },
    acpCommands: {
      clearDesc: 'Clear the conversation and start fresh',
      recapDesc: 'Summarize what happened in this session',
      loading: 'Loading slash commands…',
      updating: 'Updating slash commands…',
      loadingHint: 'Fetching slash commands from the agent',
    },
    dropToAttach: 'Drop images or PDFs to attach',
    contextUsage: {
      usedOfMax: '{{used}} / {{max}}',
      percent: '{{percent}}%',
      tokens: '{{count}} tokens',
      exceeds: 'Exceeds the current model limit',
      cost: '${{amount}}',
      free: 'Free',
    },
    send: {
      failed: 'Failed to send message: {{message}}',
      remoteUnavailable:
        'Remote host is offline or reconnecting. Try again in a moment.',
    },
    cursor: {
      apiKeyPrompt: {
        title: 'Cursor API Key required',
        description: 'Add your Cursor User API Key to continue chatting with Cursor.',
        placeholder: 'cursor_…',
        getKey: 'Get API Key',
        save: 'Save',
      },
    },
    permissionModeTitle: 'Permission Mode',
    sessionModeTitle: 'Session Mode',
    sandboxModeTitle: 'Sandbox Mode',
    permissionModes: {
      default: { label: 'Normal', description: 'Prompts for dangerous operations' },
      acceptEdits: { label: 'Accept Edits', description: 'Auto-accept file edit operations' },
      auto: { label: 'Auto', description: 'Model classifier decides each permission' },
      plan: { label: 'Plan Mode', description: 'Planning only, no actual execution' },
      dontAsk: { label: "Don't Ask", description: 'Deny anything not pre-approved' },
      bypassPermissions: { label: 'Bypass', description: 'Bypass all permission checks' },
    },
    acpPermissionModes: {
      title: 'Permission Modes',
      subtitle: 'How often Grok asks before tools run',
      ask: {
        label: 'Ask',
        description: 'Prompts for edits and shell commands',
      },
      plan: {
        label: 'Plan',
        description: 'Research and draft a plan; edits limited until you approve',
      },
      auto: {
        label: 'Auto',
        description: 'Classifier allows routine work, escalates the rest',
      },
      alwaysApprove: {
        label: 'Always Approve',
        description: 'Skip ordinary prompts; deny rules still apply',
      },
    },
    cursorPermissionModes: {
      agent: {
        label: 'Agent',
        description: 'Auto-review allows or blocks tool calls (no interactive prompts)',
      },
      plan: {
        label: 'Plan',
        description: 'Planning only, no execution',
      },
      fullAccess: {
        label: 'Full Access',
        description: 'Run tools without auto-review',
      },
    },
    sandboxModes: {
      off: { label: 'Sandbox Off', description: 'No execution isolation' },
      on: { label: 'Sandbox', description: 'Commands run in sandboxed environment' },
      auto: { label: 'Sandbox Auto', description: 'Sandbox with auto-allow Bash' },
    },
    sandboxUnsupportedTooltip: 'Sandbox is not supported on this platform',
    sandboxConditionalNotReady: 'Enable sandbox in Settings first',
    suggestions: {
      openProject: 'Open a project to get started',
      addProject: 'Add Project',
      poweredBy: 'Powered by',
      selectProject: 'Select Project',
      noProjects: 'No projects on this host',
      others: 'Others',
      acpLabel: 'ACP agents',
      selectAgent: 'Agent',
      agentNotInstalled: 'Not installed',
      agentInstallHint: 'Install this CLI on your machine, then restart SuperOne.',
      noHarnessEnabled: 'No harness enabled yet',
      enableHarnesses: 'Enable in Settings',
    },
    additionalDirs: {
      label: 'Additional folder',
      scopes: {
        user: 'User Settings',
        project: 'Project Settings',
        session: 'Session Settings',
      },
    },
    plan: {
      review: 'Review',
      requestedPermissions: 'Requested permissions',
      approve: 'Approve',
      approveAccept: 'Approve & Accept Edits',
      approveAuto: 'Approve & Auto',
      reject: 'Reject',
      feedbackPlaceholder: 'Reject feedback (optional, Enter to submit)',
      feedbackPlaceholderBoth: 'Overall feedback (optional — sent on approve or reject)',
      commentHint: 'Select text to add a sticky comment',
      emptyPlan: 'No plan content to review.',
      comments: 'Comments',
      commentOn: 'Comment on {{range}}',
      addComment: 'Add comment',
      commentPlaceholder: 'Add a comment...',
      saveComment: 'Save',
      cancelComment: 'Cancel',
      removeComment: 'Delete',
      editComment: 'Edit',
      switchTo: 'Switch to',
      acceptEdits: 'Accept Edits',
      auto: 'Auto',
      afterApproval: 'after approval',
      label: 'Plan',
      approved: 'Approved',
      rejected: 'Rejected',
      planApproved: 'Plan Approved',
      planRejected: 'Plan Rejected',
    },
    rewind: {
      title: 'Rewind',
      confirmDescription: 'Confirm you want to restore to the point before you sent this message.',
      cannotRestore: 'Cannot restore to this checkpoint.',
      previewFailed: 'Preview failed',
      codeAlreadyRestored: 'Code already restored.',
      changes: 'Changes: <green>+{{ins}}</green> <red>-{{del}}</red> in <file>{{file}}</file>',
      andOtherFiles_one: ' and {{count}} other file',
      andOtherFiles_other: ' and {{count}} other files',
      noEffectNote: 'Rewinding does not affect files edited manually or via bash.',
      restoring: 'Restoring...',
      options: {
        codeAndChat: 'Restore code and conversation',
        conversation: 'Restore conversation',
        code: 'Restore code',
        cancel: 'Never mind',
      },
      toast: {
        codeAndChat: 'Code & conversation restored',
        conversation: 'Conversation restored',
        code: 'Code restored',
      },
    },
    scrollIndicator: {
      compactTitle: 'Context compaction point',
      compactExpandedDesc: 'Earlier conversation above is expanded. Click to collapse.',
      compactCollapsedDesc: 'Earlier conversation above is compacted. Click to expand.',
      expandTooltip: 'Expand earlier conversation',
      collapseTooltip: 'Collapse earlier conversation',
    },
    turnMeta: {
      summaryLabel: 'Summary:',
      recapLabel: 'Recap:',
      generatingRecap: 'Generating recap…',
    },
    taskNotification: {
      completed: 'Background task finished',
      failed: 'Background task failed',
      stopped: 'Background task stopped',
      outputFile: 'Output log',
    },
    pasteChip: {
      title_one: 'Pasted text · {{count}} line',
      title_other: 'Pasted text · {{count}} lines',
      unsaved: '(unsaved)',
    },
    userSelectionChip: {
      title_one: '{{count}} quote',
      title_other: '{{count}} quotes',
      popoverTitle_one: 'Quoted selection',
      popoverTitle_other: '{{count}} quoted selections',
    },
    selectionMenu: {
      copy: 'Copy',
      addToChat: 'Add to Chat',
    },
    codex: {
      statusRunning: 'Running',
      statusReading: 'Reading',
      statusSearching: 'Searching',
      startingMcpServers: 'Starting MCP servers {{ready}}/{{total}}',
      mcpNeedsReauth: 'MCP server {{name}} needs re-authentication',
      mcpStartupFailed: 'MCP server {{name}} failed to start',
      mcpReauthenticating: 'Waiting for authorization…',
      mcpReauthSuccess: 'Re-authenticated {{name}}',
      mcpReauthFailed: 'Re-authentication failed for {{name}}',
      runningInline: 'Running…',
      waitingFor: 'Waiting for {{name}}',
      waitingForWithElapsed: 'Waiting for {{name}} for {{elapsed}}s...',
      fallbackAgentName: 'subagent',
      codexError: 'Codex Error',
      startReview: 'Start review',
      reviewComplete: 'Review complete',
      conversationCompacted: 'Conversation compacted',
      sendingFollowUp: 'Sending follow-up',
      sendFollowUp: 'Send Follow-up',
      followUpSent: 'Follow-up Sent',
      loadImage: 'Load Image',
      imageGenerationFailed: 'The image could not be generated',
      imageLoadFailed: 'The generated image could not be loaded',
      generatedImageAlt: 'Generated image',
      appToolCalls_one: '{{count}} tool call',
      appToolCalls_other: '{{count}} tool calls',
      commandGroupRead_one: 'Read {{count}} file',
      commandGroupRead_other: 'Read {{count}} files',
      commandGroupSearch_one: 'searched {{count}} code',
      commandGroupSearch_other: 'searched {{count}} code',
      commandGroupCombined: '{{read}}, {{search}}',
      exploringCode: 'Exploring code',
      exploreCode: 'Explore Code',
      codeExplored: 'Code Explored',
      modelFallback: 'Codex model',
      permissionPreset: 'Permission Preset',
      goal: {
        label: 'Goal',
        title: 'Codex Goal',
        description: 'Anchor what this Codex thread is trying to achieve. The model uses it to keep turns on track.',
        noThread: 'Start a Codex session first (send a message), then come back to set a goal.',
        placeholder: 'e.g. Refactor the auth middleware to use JWT and ship behind the legacy flag',
        save: 'Save goal',
        edit: 'Edit',
        pause: 'Pause',
        resume: 'Resume',
        clear: 'Clear goal',
        status: 'Status: {{status}}',
        statuses: {
          active: 'Active',
          paused: 'Paused',
          blocked: 'Blocked',
          usageLimited: 'Usage limited',
          budgetLimited: 'Budget limited',
          complete: 'Complete',
        },
      },
    },
    image: {
      copyImage: 'Copy Image',
      copyPrompt: 'Copy Prompt',
      openFolder: 'Open Folder',
      addToChat: 'Add to Chat',
      download: 'Download',
      copied: 'Image copied to clipboard',
      promptCopied: 'Prompt copied to clipboard',
      copyFailed: 'Copy failed: {{error}}',
      downloaded: 'Image saved to {{path}}',
      downloadFailed: 'Download failed: {{error}}',
      generatedIn: 'Generated in {{duration}}',
      noMetadata: 'No metadata available.',
      prompt: 'Prompt',
      warnings: 'Warnings',
      paramProvider: 'Provider',
      paramModel: 'Model',
      paramSize: 'Size',
      paramAspectRatio: 'Aspect ratio',
      paramReferenceImages: 'Reference images',
    },
    worktree: {
      searchPlaceholder: 'Search worktrees and branches…',
      existingHeading: 'Existing worktrees',
      createFromHeading: 'Create new worktree from',
      attachToHeading: 'Attach to',
      detachAtHeading: 'Detach at',
      modeBranch: 'New branch',
      modeAttach: 'Attach',
      modeDetach: 'Detach',
      baseBranchLabel: 'Base branch',
      branchNameLabel: 'New branch name',
      branchNamePlaceholder: 'e.g. fix/login-bug',
      branchExists: 'Branch {{name}} already exists',
      switchToAttach: 'Switch to Attach',
      attachUnavailableMain: 'Already checked out in main repo',
      attachUnavailableOther: 'Already checked out in another worktree',
      attachInfo: 'Worktree will check out {{branch}}. Continue work on this existing branch in an isolated directory.',
      detachInfo: 'Worktree will detach at {{branch}} ({{hash}}). No branch is created.',
      lazyHint: 'Worktree will be created on next message',
      detachedLabel: 'Detached',
      attachedLabel: 'attached',
      fromLabel: 'from {{branch}}',
      cleanLabel: 'clean',
      filesCount_one: '{{count}} file',
      filesCount_other: '{{count}} files',
      carryLocalChanges: 'Carry local changes',
      noMatches: 'No matches',
      createFromLabel: 'Create worktree from:',
      triggerCreateFrom: 'Create worktree from <branch></branch> {{base}}',
      triggerAttachTo: 'Attach worktree to <branch></branch> {{base}}',
      triggerCreateBranch: 'Create worktree branch <branch></branch> {{name}}',
      triggerActiveBranch: 'Worktree <branch></branch> {{name}}',
      triggerActiveDetached: 'Worktree <commit></commit>{{hash}}',
      forkHeading: 'Fork to new worktree',
      forkInfo: 'Fork this conversation into an independent session running in a new worktree.',
      forkIncludesChanges: 'Includes local changes',
      forkButton: 'Fork session',
      handoffHeading: 'Hand off changes to main checkout',
      handoffInfo: "Copy this worktree's changes into the main checkout.",
      handoffButton: 'Hand off',
      handoffSuccess: 'Changes handed off to main checkout',
      handoffErrorNoChanges: 'Nothing to hand off',
      handoffErrorLocalDirty: 'The main checkout has uncommitted changes — commit or stash them first',
      handoffErrorConflict: 'Changes conflict with the main checkout — nothing was handed off',
      handoffErrorNotWorktree: 'Not running in a worktree',
      handoffErrorGeneric: 'Handoff failed',
      assignHeading: 'Assign to a branch',
      assignInfo: "Name this detached worktree's commits as a branch — it stays here, ready to commit and push.",
      assignPlaceholder: 'e.g. feat/login',
      assignButton: 'Assign branch',
      assignSuccess: 'Worktree assigned to {{name}}',
      assignErrorExists: 'Branch {{name}} already exists',
      assignErrorCheckedOut: 'Branch {{name}} is checked out in another worktree',
      assignErrorGeneric: 'Could not assign branch',
    },
    git: {
      init: 'Init Git',
      initHint: 'Initialize a new git repository in this folder',
      initSuccess: 'Git repository initialized',
      initFailed: 'Git init failed: {{error}}',
    },
    permission: {
      sandboxNetwork: 'Sandbox Network',
      allowSandboxNetwork: 'Allow Sandbox Network Access',
      sandboxOverride: 'Sandbox Override',
      networkAccess: 'Network Access',
      blockedPath: 'Blocked path: {{path}}',
      inputHeading: 'Input',
      suggestionsHeading: 'Suggestions',
      allow: 'Allow',
      allowForSession: 'Allow for this session',
      decline: 'Decline',
      deny: 'Deny',
      denyReasonPlaceholder: 'Deny reason (optional, Enter to submit)',
      alwaysAllow: 'Always Allow',
      sessionCleanupTitle: 'Permanently delete {{count}} session(s)?',
      sessionCleanupEmpty: 'No sessions selected.',
      sessionCleanupDelete: 'Delete',
      sessionCleanupCancel: 'Cancel',
      sessionCleanupUnknownProject: 'Unknown project',
      automationCreateTitle: 'Create automation?',
      automationUpdateTitle: 'Update automation?',
      automationDeleteTitle: 'Permanently delete {{count}} automation(s)?',
      automationEmpty: 'No automations selected.',
      automationFieldName: 'Name',
      automationFieldSchedule: 'Schedule',
      automationFieldAgent: 'Agent',
      automationFieldEnabled: 'Enabled',
      automationFieldPrompt: 'Prompt',
      automationEnabledOn: 'on',
      automationEnabledOff: 'off',
      automationChangeFromTo: '{{from}} → {{to}}',
    },
    computerUseGrant: {
      badge: 'Computer Use',
      title: 'Allow access to {{app}}?',
      description: 'The agent wants to control this app.',
      collapsed: 'Allow {{app}}?',
      viaTool: '{{tool}}',
      allowSession: 'Allow this session',
      alwaysAllow: 'Always allow',
      deny: 'Deny',
    },
    videoGenConfirm: {
      title: 'Confirm Video Generation',
      promptLabel: 'Prompt',
      promptPlaceholder: 'Describe the scene, motion, and camera direction…',
      providerLabel: 'Provider',
      modelLabel: 'Model',
      aspectRatioLabel: 'Aspect Ratio',
      resolutionLabel: 'Resolution',
      durationLabel: 'Duration (s)',
      advancedOptions: 'Advanced Options',
      fpsLabel: 'FPS',
      fpsPlaceholder: 'Auto',
      seedLabel: 'Seed',
      seedPlaceholder: 'Random',
      generateAudio: 'Generate Audio',
      watermark: 'Watermark',
      lockCamera: 'Lock Camera',
      confirm: 'Confirm & Generate',
      reject: 'Reject',
      feedbackPlaceholder: 'Feedback (required, Enter to submit)',
      startFrame: 'Start Frame',
      endFrame: 'End Frame',
      reference: 'Reference {{index}}',
    },
    videoGenToolBlock: {
      label: 'Video Generated',
      generating: 'Generating video',
      submitted: 'Submitted',
      rendering: 'Rendering…',
      completed: 'Completed',
      failed: 'Failed',
      referenceMaterials: 'Reference Materials',
      firstFrame: 'First frame',
      lastFrame: 'Last frame',
      referenceImages: 'Reference images',
      referenceVideos: 'Reference videos',
      referenceAudio: 'Reference audio',
      reference: 'Reference {{index}}',
      prompt: 'Prompt',
      provider: 'Provider',
      model: 'Model',
      aspectRatio: 'Aspect Ratio',
      resolution: 'Resolution',
      duration: 'Duration',
      fps: 'FPS',
      seed: 'Seed',
      generateAudio: 'Generate Audio',
      watermark: 'Watermark',
      cameraFixed: 'Lock Camera',
      on: 'on',
      off: 'off',
      warnings_one: '{{count}} warning',
      warnings_other: '{{count}} warnings',
    },
    configConfirm: {
      title: 'Confirm Settings Change',
      confirm: 'Confirm & Apply',
      deleteConfirm: 'Delete',
      reject: 'Reject',
      feedbackPlaceholder: 'Feedback (optional)',
      currentValue: 'Current: {{value}}',
      defaultOption: 'Default',
      clearedValue: 'Default',
      emptyValue: 'Not set',
      modelCount: '{{count}} model(s)',
    },
    sessionAgentsConfirm: {
      title: 'Request Agents Collaboration',
      subtitle: '{{count}} requested launch(es)',
      defaultProvider: 'Default AI provider',
      workingDirectory: 'Working directory',
      peerSession: 'Peer session',
      peerProject: 'Peer project',
      workWith: 'Work with:',
      openPeerSession: 'Open session',
      expandTask: 'Show the full task',
      collapseTask: 'Collapse the task',
      hintSwitch: 'switch agent',
      reject: 'Reject',
      approve: 'Approve',
    },
    collaboration: {
      initialTask: 'Agent task',
      fromAgent: 'From agent',
      toAgent: 'To agent',
      taskNotification: 'System wake',
      mailboxReady: 'Inbox has messages',
      expandTask: 'Expand',
      collapseTask: 'Collapse',
    },
    askUser: {
      otherOption: 'Other...',
      selectOptionPreview: 'Select an option to preview',
      noteOptionalPlaceholder: 'Add a note (optional)...',
      submit: 'Submit',
      hintSwitch: 'switch',
      hintNote: 'note',
      hintSelect: 'select',
      hintDismiss: 'dismiss',
    },
    toolBlock: {
      enteredPlanMode: 'Entered plan mode',
      readingWidgetGuidelines: 'Reading widget guidelines…',
      readWidgetGuidelines: 'Widget Guidelines Read',
      readingMiniAppGuide: 'Reading mini-app guide',
      readMiniAppGuide: 'Mini-app Guide Read',
      readingMediaGuide: 'Reading media guide',
      readMediaGuide: 'Media Guide Read',
      readingConfig: 'Reading settings',
      readConfig: 'Settings Read',
      readingManual: 'Reading manual',
      readManual: 'Manual Read',
      guideOverview: 'Overview',
      applyingSettings: 'Updating settings',
      appliedSettings: 'Settings Updated',
      updateSettings: 'Update Settings',
      createSettings: 'Create Settings',
      deleteSettings: 'Delete Settings',
      readSettings: 'Read Settings',
      readManualAction: 'Read Manual',
      settingsChangeRejected: 'Settings Change Rejected',
      settingsChangeCancelled: 'Settings Change Dismissed',
      settingsChangeFailed: 'Settings Change Failed',
      settingsChangeCount: '{{count}} changes',
      configCreated: 'Settings Created',
      configUpdated: 'Settings Updated',
      configDeleted: 'Settings Deleted',
      generatingImage: 'Generating image',
      generatedImage: 'Image Generated',
      generateImage: 'Generate Image',
      image: {
        fields: {
          prompt: 'Prompt',
          provider: 'Provider',
          model: 'Model',
          aspectRatio: 'Aspect Ratio',
          size: 'Size',
          referenceImages: 'Reference Images',
          reference: 'Reference {{index}}',
        },
      },
      generatingVideo: 'Generating video',
      generatedVideo: 'Video Generated',
      generateVideo: 'Generate Video',
      listingMediaProviders: 'Listing providers',
      listedMediaProviders: 'Providers Listed',
      listMediaProviders: 'List Providers',
      mediaProvidersMatched: '{{count}} matched',
      registeringMiniApp: 'Registering mini-app',
      registeredMiniApp: 'Mini-app Registered',
      registerMiniApp: 'Register Mini-app',
      updatingMiniAppTypes: 'Updating types',
      updatedMiniAppTypes: 'Types Updated',
      updateMiniAppTypes: 'Update Types',
      listingWidgetTemplates: 'Listing widget templates',
      listedWidgetTemplates: 'Widget Templates Listed',
      listWidgetTemplates: 'List Widget Templates',
      checkingVideoStatus: 'Checking video status',
      checkVideoStatus: 'Check Video Status',
      settingUpMiniApp: 'Setting up mini-app',
      setUpMiniApp: 'Mini-app Set Up',
      setupMiniApp: 'Set Up Mini-app',
      setUpMiniAppFailed: 'Mini-app Setup Failed',
      setupFields: {
        directory: 'Directory',
        description: 'Description',
        appId: 'App ID',
      },
      packing: 'Packing…',
      miniAppPacked: 'Mini-app Packed',
      generatingWidget: 'Generating widget…',
      generateWidget: 'Widget Generated',
      collab: {
        requestingCollaboration: 'Requesting collaboration…',
        collaborationRequested: 'Collaboration Requested',
        startingCollaborationSession: 'Starting session',
        collaborationSessionStarted: 'Session Started',
        sendingMessageTo: 'Sending message to',
        messageSent: 'Message Sent',
        retrievingMessages: 'Retrieving messages',
        messagesRetrieved: 'Messages Retrieved',
        messageReceived: 'Message Received',
        receivedMessageCount: '{{count}} Messages Retrieved',
        noMessages: 'No messages',
        agentCount: '{{count}} agents',
        messageCount: '{{count}} messages',
        remainingCount: '{{count}} remaining',
        agentSession: 'Agent session',
        reused: 'reused',
        showFullMessage: 'Show full message',
        showLessMessage: 'Show less',
        fields: {
          name: 'Name',
          model: 'Model',
          effort: 'Effort',
          permission: 'Permission',
          sandbox: 'Sandbox',
          cwd: 'Working dir',
          role: 'Role',
          sessionId: 'Session',
          to: 'To',
          from: 'From',
          message: 'Message',
        },
      },
      // Session archive tools — same casing grammar as collab:
      // streaming = sentence case (+ …); done primary labels = Title Case.
      archive: {
        listingProjects: 'Listing projects…',
        projectsListed: 'Projects Listed',
        listProjects: 'List Projects',
        projectListFailed: 'List Failed',
        projectCount: '{{count}} projects',
        emptyProjects: 'No projects',
        thisProject: 'current',
        missingProject: 'missing',
        openProject: 'Open project',
        listingSessions: 'Listing sessions…',
        sessionsListed: 'Sessions Listed',
        listSessions: 'List Sessions',
        listFailed: 'List Failed',
        searchingSessions: 'Searching sessions…',
        sessionSearch: 'Sessions Searched',
        searchSessions: 'Search Sessions',
        hitsFound: 'Found {{count}} hits',
        noHits: 'No hits',
        searchFailed: 'Search Failed',
        readingSessionMeta: 'Reading session meta…',
        sessionMeta: 'Session Meta Read',
        readSessionMeta: 'Read Session Meta',
        readingUserMessages: 'Reading user messages…',
        userMessages: 'User Messages Read',
        readUserMessages: 'Read User Messages',
        readingAssistantMessages: 'Reading assistant messages…',
        assistantMessages: 'Assistant Messages Read',
        readAssistantMessages: 'Read Assistant Messages',
        readingConversation: 'Reading conversation…',
        conversation: 'Conversation Read',
        readConversation: 'Read Conversation',
        readingToolIndex: 'Reading tool index…',
        toolIndex: 'Tool Index Read',
        readToolIndex: 'Read Tool Index',
        readingToolDetail: 'Reading tool detail…',
        toolDetail: 'Tool Detail Read',
        readToolDetail: 'Read Tool Detail',
        readFailed: 'Read Failed',
        previewingCleanup: 'Previewing cleanup…',
        cleanupPreview: 'Cleanup Previewed',
        hidingSessions: 'Hiding sessions…',
        sessionsHidden: 'Sessions Hidden',
        hideSessions: 'Hide Sessions',
        unhidingSessions: 'Unhiding sessions…',
        sessionsUnhidden: 'Sessions Unhidden',
        unhideSessions: 'Unhide Sessions',
        confirmingDelete: 'Confirming delete…',
        sessionsDeleted: 'Sessions Deleted',
        deleteSessions: 'Delete Sessions',
        sessionsDeletedPartial: 'Partially Deleted',
        deleteCancelled: 'Delete Cancelled',
        deleteRejected: 'Delete Rejected',
        cleanupFailed: 'Cleanup Failed',
        sessionCount: '{{count}} sessions',
        candidateCount: '{{count}} candidates',
        partialDeleteSummary: '{{deleted}} deleted · {{failed}} failed',
        beforeDate: 'before {{date}}',
        thisChat: 'this chat',
        pinned: 'pinned',
        emptySessions: 'No sessions',
        emptyHits: 'No hits',
        openSession: 'Open session',
        deletedSection: 'Deleted',
        failedSection: 'Failed',
        affectedSection: 'Affected',
        candidatesSection: 'Candidates',
        wereCandidatesSection: 'Were candidates',
        skippedPinnedSection: 'Skipped (pinned)',
        pageHint: 'Page · {{hint}}',
        taggingSession: 'Tagging session…',
        sessionTagged: 'Session Tagged',
        tagSession: 'Tag Session',
        tagFailed: 'Tag Failed',
        fields: {
          title: 'Title',
          harness: 'Harness',
          messages: 'Messages',
          active: 'Active',
          model: 'Model',
          branch: 'Branch',
          sessionId: 'Session',
          tool: 'Tool',
          id: 'Id',
          input: 'Input',
          result: 'Result',
          tag: 'Tag',
          sessions: 'Sessions',
        },
      },
      /** automation_list / automation_apply / automation_delete — casing mirrors collab. */
      automation: {
        listingAutomations: 'Listing automations…',
        automationsListed: 'Automations Listed',
        listAutomations: 'List Automations',
        readingAutomation: 'Reading automation…',
        automationDetail: 'Automation Read',
        readAutomation: 'Read Automation',
        listFailed: 'Automation List Failed',
        empty: 'No automations',
        automationCount: '{{count}} automations',
        automationCreated: 'Automation Created',
        createAutomation: 'Create Automation',
        automationUpdated: 'Automation Updated',
        updateAutomation: 'Update Automation',
        enableAutomation: 'Enable Automation',
        disableAutomation: 'Disable Automation',
        deleteAutomations: 'Delete Automations',
        confirmingCreate: 'Confirming create…',
        confirmingUpdate: 'Confirming update…',
        confirmingEnable: 'Confirming enable…',
        confirmingDisable: 'Confirming disable…',
        automationEnabled: 'Automation Enabled',
        automationDisabled: 'Automation Disabled',
        createFailed: 'Automation Create Failed',
        updateFailed: 'Automation Update Failed',
        enableFailed: 'Automation Enable Failed',
        disableFailed: 'Automation Disable Failed',
        createCancelled: 'Automation Create Cancelled',
        updateCancelled: 'Automation Update Cancelled',
        enableCancelled: 'Automation Enable Cancelled',
        disableCancelled: 'Automation Disable Cancelled',
        createRejected: 'Automation Create Rejected',
        updateRejected: 'Automation Update Rejected',
        enableRejected: 'Automation Enable Rejected',
        disableRejected: 'Automation Disable Rejected',
        confirmingDelete: 'Confirming delete…',
        automationsDeleted: 'Automations Deleted',
        automationsDeletedPartial: 'Partially Deleted',
        nothingDeleted: 'Nothing Deleted',
        deleteCancelled: 'Automation Delete Cancelled',
        deleteRejected: 'Automation Delete Rejected',
        deleteFailed: 'Automation Delete Failed',
        partialDeleteSummary: '{{deleted}} deleted · {{failed}} failed',
        deletedSection: 'Deleted',
        failedSection: 'Failed',
        enabled: 'on',
        disabled: 'off',
        fields: {
          name: 'Name',
          schedule: 'Schedule',
          status: 'Status',
          prompt: 'Prompt',
          agent: 'Agent',
        },
      },
      dismissed: 'Dismissed',
      denied: 'Denied',
      error: 'Error',
      running: 'Running…',
      runningInline: 'Running…',
      timedOut: 'Timed out',
      outputFileExpired: 'Output file: {{path}} expired',
      collapse: 'Collapse',
      moreLines_one: '{{count}} more line',
      moreLines_other: '{{count}} more lines',
      showFullCommand: 'Show full command',
      collapseCommand: 'Collapse command',
      showFullOutput: 'Show full output',
      collapseOutput: 'Collapse output',
      browser: {
        navigate: 'Navigate',
        navigating: 'Navigating',
        open: 'Open Tab',
        opening: 'Opening Tab',
        snapshot: 'Snapshot',
        snapshotting: 'Taking snapshot…',
        query: 'Query',
        querying: 'Querying',
        inspect: 'Inspect',
        inspecting: 'Inspecting',
        screenshot: 'Screenshot',
        screenshotting: 'Taking screenshot…',
        click: 'Click',
        clicking: 'Clicking',
        hover: 'Hover',
        hovering: 'Hovering',
        type: 'Type',
        typing: 'Typing',
        press: 'Press',
        pressing: 'Pressing',
        scroll: 'Scroll',
        scrolling: 'Scrolling',
        drag: 'Drag',
        dragging: 'Dragging',
        select: 'Select',
        selecting: 'Selecting',
        waitFor: 'Wait For',
        waitingFor: 'Waiting For',
        evaluate: 'Evaluate',
        evaluating: 'Evaluating',
        tabs: 'Tabs',
        listingTabs: 'Listing Tabs',
        resize: 'Resize',
        resizing: 'Resizing',
        networkStart: 'Record Network',
        recordingNetwork: 'Recording Network',
        networkStop: 'Collect Network',
        collectingNetwork: 'Collecting Network',
        networkWait: 'Wait For Request',
        waitingForRequest: 'Waiting For Request',
        networkBody: 'Response Body',
        loadingResponseBody: 'Loading Response Body',
        cookies: 'Cookies',
        readingCookies: 'Reading Cookies',
        uploadFile: 'Upload File',
        uploadingFile: 'Uploading File',
        download: 'Download',
        downloading: 'Downloading',
        downloaded: 'Downloaded',
        downloadBackground: 'Downloading In Background',
        downloadBackgroundHint: 'This file is still downloading. You will get a notification when it finishes.',
        downloadSaveTo: 'Save To…',
        downloadSaved: 'Saved',
        downloadSaveFailed: 'Could Not Save File',
        downloadPath: 'Path',
        downloadSize: 'Size',
        downloadMime: 'Type',
        downloadUrl: 'URL',
        downloadProgress: '{{loaded}} / {{total}}',
        listDownloads: 'List Downloads',
        listingDownloads: 'Listing Downloads',
        listDownloadsEmpty: 'No downloads captured',
        downloadStateCompleted: 'Completed',
        downloadStateProgressing: 'Downloading',
        downloadStateCancelled: 'Cancelled',
        downloadStateInterrupted: 'Interrupted',
        emulate: 'Emulate',
        emulating: 'Emulating',
        mock: 'Mock',
        mocking: 'Mocking',
        actionList: 'Browser Actions',
        listingActions: 'Listing Browser Actions',
        actionSave: 'Save Browser Action',
        savingAction: 'Saving Browser Action',
        actionDo: 'Run Browser Action',
        doingAction: 'Running Browser Action',
        elements_one: '{{count}} element',
        elements_other: '{{count}} elements',
        matches_one: '{{count}} match',
        matches_other: '{{count}} matches',
        tabsCount_one: '{{count}} tab',
        tabsCount_other: '{{count}} tabs',
        requests_one: '{{count}} request',
        requests_other: '{{count}} requests',
        cookiesCount_one: '{{count}} cookie',
        cookiesCount_other: '{{count}} cookies',
        downloads_one: '{{count}} download',
        downloads_other: '{{count}} downloads',
        actions_one: '{{count}} action',
        actions_other: '{{count}} actions',
        notFound: 'Not Found',
        viewport: 'Viewport',
        screenshotUnavailable: 'Screenshot No Longer Available',
        code: 'Code',
        result: 'Result',
        mockUrl: 'URL',
        mockStatus: 'Status',
        mockContentType: 'Content-Type',
        mockBody: 'Body',
      },
      computer: {
        apps: 'Apps',
        listingApps: 'Listing Apps',
        focus: 'Focus App',
        focusing: 'Focusing App',
        launch: 'Launch App',
        launching: 'Launching App',
        snapshot: 'Snapshot',
        snapshotting: 'Taking snapshot…',
        zoom: 'Zoom',
        zooming: 'Zooming',
        query: 'Query',
        querying: 'Querying',
        search: 'Search',
        searching: 'Searching',
        expand: 'Expand',
        expanding: 'Expanding',
        inspect: 'Inspect',
        inspecting: 'Inspecting',
        act: 'Control',
        acting: 'Controlling',
        click: 'Click',
        clicking: 'Clicking',
        type: 'Type',
        typing: 'Typing',
        press: 'Press',
        pressing: 'Pressing',
        scroll: 'Scroll',
        scrolling: 'Scrolling',
        drag: 'Drag',
        dragging: 'Dragging',
        movePointer: 'Move Pointer',
        movingPointer: 'Moving Pointer',
        waitFor: 'Wait For',
        waitingFor: 'Waiting For',
        screenshot: 'Desktop Screenshot',
        screenshotUnavailable: 'Screenshot No Longer Available',
        json: 'JSON',
        appsCount_one: '{{count}} running app',
        appsCount_other: '{{count}} running apps',
        windowsCount_one: '{{count}} window',
        windowsCount_other: '{{count}} windows',
        matchesCount_one: '{{count}} match',
        matchesCount_other: '{{count}} matches',
        outcome: {
          worked: 'Worked',
          didnt: 'No Effect',
          unknown: 'Unverified',
        },
        waitStatus: {
          preexisting: 'Already Matched',
          verified: 'Matched',
          failed: 'Not Matched',
        },
      },
    },
    subagent: {
      spawning: 'Spawning subagent...',
      runningInBackground: 'Running in background',
      running: 'Running',
      done: 'Done',
      failed: 'Failed',
      stopped: 'Stopped',
      output: 'Output',
      prompt: 'Prompt',
      title: 'Subagent',
      notFound: 'Subagent not found',
      openFullView: 'Open full view',
      noActivity: 'No activity recorded',
      retrying: 'Rate limited — retrying ({{attempt}}/{{max}})',
    },
    codexCollab: {
      defaultName: 'Subagent',
      errored: 'Errored',
      failed: 'Failed',
      openFullView: 'Open full view',
      backToMain: 'Back to main',
      forked: 'forked',
      failureSummary: '{{tool}} failed: {{message}}',
      failureNotFound: 'Subagent is not available. Resume it, then retry this follow-up.',
      failureNoDetails: 'No error details were returned.',
      turnCount_one: '{{count}} turn',
      turnCount_other: '{{count}} turns',
      noItems: 'No items yet in this branch.',
      noOutput: 'No agent output yet for this turn.',
      toolLabels: {
        spawnAgent: 'Task',
        sendInput: 'Follow-up',
        resumeAgent: 'Resume',
        wait: 'Wait',
        closeAgent: 'Close',
      },
      turnLabels: {
        spawnAgent: 'Initial prompt',
        sendInput: 'Follow-up',
        resumeAgent: 'Resume',
        wait: 'Wait',
        closeAgent: 'Close',
      },
      miniTool: {
        bash: 'Bash',
        edit: 'Edit',
        webSearch: 'Web search',
        filesFallback_one: '{{count}} file',
        filesFallback_other: '{{count}} files',
      },
    },
    codexCommands: {
      helpDesc: 'Show available commands',
      resetDesc: 'Reset Codex thread',
      authDesc: 'Show auth status',
      authAutoDesc: 'Auto auth mode (prefer API key)',
      authChatgptDesc: 'Use ChatGPT sign-in mode',
      authApiKeyDesc: 'Use API key mode',
      authApiKeyArg: '<CODEX_API_KEY>',
      reviewDesc: 'Review code changes',
      compactDesc: 'Compact thread context',
      planDesc: 'Enter plan mode',
      providerDesc: 'Choose API provider for this session',
      mcpDesc: 'View MCP servers in this session',
      goalDesc: 'Set or clear the goal for this Codex thread',
      goalArg: '[objective]',
    },
    providerPopup: {
      title: 'Choose a provider for this session',
      addProvider: 'Add new provider…',
      willSwitchAfterStreaming: 'Will switch after current response',
    },
    mcpPopup: {
      title: 'MCP Servers',
      liveBadge: 'Live · {{harness}} session',
      probeBadge: 'Probed from config · no active session',
      empty: 'No MCP servers configured for this project',
      emptyHint: 'Add servers in Settings → MCP',
      manageInSettings: 'Manage in Settings',
      refresh: 'Refresh',
      noActiveSession: 'Start a turn to load live MCP status',
      errorBadge: 'error',
      authBadge: 'auth',
      authenticate: 'Authenticate {{name}}',
    },
    slashCommand: {
      groupCommands: 'Slash commands',
      groupSkills: 'Skills',
    },
    mentionPopup: {
      groupCapabilities: 'Built-in',
      groupSessions: 'Sessions',
      groupDesktopApps: 'Desktop Apps',
      groupAgents: 'Agents',
      groupMiniApps: 'Mini apps',
      groupFiles: 'Files',
      capabilityCollab: 'Agents Collaboration',
      capabilityComputer: 'Computer Use',
      capabilityBrowser: 'Super Browser',
      capabilityWidget: 'Widget',
      capabilityDebug: 'Debug',
      capabilitySession: 'Session',
      groupSessionProjects: 'Project scope',
      groupRecentSessions: 'Recent',
      noSessions: 'No matching sessions',
      noRecentSessions: 'No recent sessions',
      noProjects: 'No matching projects',
      sessionNeedTitle: 'Type a title query to search sessions',
      sessionNeedTitleShort: 'type title…',
      sessionPickProject: 'choose project',
      sessionAllProjects: 'All Projects',
      sessionAllProjectsHint: 'Type all · search every project',
      hintSelectSession: 'select session',
      hintCompleteProject: 'complete project',
      hintTypeTitle: 'type title to search',
      loadingSessions: 'Loading…',
      scrollForMore: 'Scroll for more',
      disabled: 'Off',
      computerUseDisabledHint: 'Enable Computer Use in Settings first',
      browserDisabledHint: 'Enable Browser CDP in Settings first',
    },
    linkSafety: {
      openExternal: 'Open link',
      copyLink: 'Copy link',
      copied: 'Copied',
      openLink: 'Open in external browser',
      openInApp: 'Open in built-in browser',
      openInAppHint: 'Tips: <key/>-click a link to open in the built-in browser',
    },
    browser: {
      addressPlaceholder: 'Search or enter a URL',
      previewLabel: 'Browser picture in picture',
      previewExpandedLabel: 'Expanded browser preview',
      previewHide: 'Hide browser preview',
      previewExpand: 'Expand browser preview',
      previewShrink: 'Shrink browser preview',
      screenshotCopied: 'Screenshot copied to clipboard',
      screenshotFailed: 'Failed to capture screenshot',
      quickAnnotate: 'Quick Annotation',
      quickAnnotateWithScreenshot: 'Quick Annotation with Screenshot',
      copyText: 'Copy Text',
      addTextToChat: 'Add Text to Chat',
      addImageToChat: 'Add Image to Chat',
      copyImage: 'Copy Image',
      copyImageAddress: 'Copy Image Address',
      saveImage: 'Save Image',
      imageSaved: 'Image saved',
      imageSaveFailed: 'Failed to save image',
      openLinkNewTab: 'Open Link in New Tab',
      openLinkExternal: 'Open Link in External Browser',
      copyLink: 'Copy Link Address',
      inspect: 'Inspect',
      annotateEnter: 'Annotate',
      annotateExit: 'Exit annotate mode',
      annotating: 'Annotating',
      annotateElement: 'Element',
      annotateRegion: 'Region',
      annotationCount_one: '{{count}} annotation',
      annotationCount_other: '{{count}} annotations',
      annotatePlaceholder: 'Add a note…',
      annotateConfirm: 'Add',
      annotateCancel: 'Cancel',
      annotateScreenshot: 'Screenshot',
      styleColor: 'Text color',
      styleBackground: 'Background',
      styleSize: 'Font size',
      styleWeight: 'Font weight',
      styleRadius: 'Radius',
      stylePadding: 'Padding',
      searchFor: 'Search for "{{query}}"',
      bookmark: 'Add Bookmark',
      bookmarkEdit: 'Edit Bookmark',
      bookmarkAdded: 'Bookmark Added',
      bookmarkName: 'Name',
      bookmarkUrl: 'URL',
      bookmarkNoFolder: 'No folder',
      bookmarkRemove: 'Remove',
      bookmarkDone: 'Done',
      bookmarks: 'Bookmarks',
      openExternal: 'Open in External Browser',
      zoom: 'Zoom',
      zoomIn: 'Zoom In',
      zoomOut: 'Zoom Out',
      zoomReset: 'Reset',
      newFolder: 'New folder',
      newFolderName: 'New folder',
      renameFolder: 'Rename folder',
      folderNamePlaceholder: 'Folder name',
      folderExists: 'A folder with this name already exists',
      removeFromFolder: 'Remove from folder',
      noBookmarks: 'No bookmarks yet',
      deleteFolder: 'Delete folder',
      emptyFolder: 'Empty',
      insecureTitle: 'Your connection is not private',
      insecureBody: 'Attackers might be trying to steal your information from {{host}} (for example, passwords, messages, or credit cards).',
      insecureDetails: 'Advanced',
      insecureHide: 'Hide details',
      insecureAdvanced: 'This site’s security certificate could not be verified. Proceeding may expose your data to attackers.',
      insecureProceed: 'Continue to {{host}} (unsafe)',
      insecureBack: 'Back to safety',
      insecureReasonExpired: 'This site’s security certificate has expired, so its identity cannot be verified.',
      insecureReasonName: 'This site’s security certificate does not match its address, so its identity cannot be verified.',
      insecureReasonAuthority: 'This site’s security certificate is not trusted (self-signed or from an unknown authority).',
      insecureReasonGeneric: 'This site’s security certificate could not be verified.',
    },
    reasoning: {
      thinking: 'Thinking...',
      thinkingSeconds: 'Thinking for {{count}}s...',
      thought: 'Thought',
      thoughtSeconds: 'Thought for {{count}}s',
    },
    mermaid: {
      label: 'Mermaid',
      error: 'Mermaid Error:',
    },
  },
  resources: {
    sectionUser: 'User',
    sectionProject: 'Project',
    agents: {
      title: 'Subagents',
      subtitle: 'Browse custom agent definitions',
      empty: 'No agents found',
      emptyHint: 'User: ~/.claude/agents/ | Project: .claude/agents/',
    },
    skills: {
      title: 'Skills',
      subtitleClaude: 'Manage Claude Code skills',
      subtitleCodex: 'Manage Codex skills',
      empty: 'No skills found',
      emptyHintClaude: 'User: ~/.claude/skills/ | Project: .claude/skills/',
      emptyHintCodex: 'User: ~/.agents/skills/, ~/.codex/skills/ (incl. .system) | Project: .agents/skills/, .codex/skills/',
      install: 'Install Skill',
      selectFile: 'Select a file to preview',
      deleteTitle: 'Delete Skill?',
      deleteDescSuffix: 'will be removed from your skills.',
      deleting: 'Deleting...',
      delete: 'Delete',
      deleteTooltip: 'Delete skill',
      previewToggle: 'Preview',
      sourceToggle: 'Source',
      hideFromAgent: 'Hide from Agent',
      showToAgent: 'Show to Agent',
      disabled: 'Disabled',
      builtin: 'Built-in',
      plugin: 'Plugin',
      readonly: 'Read-only',
    },
    providers: {
      title: 'Providers',
      subtitleClaude: 'Configure third-party Anthropic-compatible API providers',
      subtitleCodex: 'Configure third-party OpenAI-compatible API providers for Codex',
      subtitleUnified: 'Manage API providers and their capabilities (chat, image, …)',
      activateFor: 'Activate for',
      enabled: 'Enabled',
      disabled: 'Disabled',
      selectHint: 'Select a provider to view and edit its configuration',
      defaultImageProviderLabel: 'Default Image Provider',
      defaultImageProviderDescription: 'Used by the image tool when no provider is specified. Its first enabled model is the default.',
      defaultImageProviderAuto: 'Auto (First Usable)',
      add: 'Add Provider',
      addCustom: 'Add Custom Provider',
      addKey: 'Add Key',
      newKey: 'New Key',
      others: 'Others',
      keyCount_one: '{{count}} key',
      keyCount_other: '{{count}} keys',
      accountPlan: 'Plan',
      accountEmail: 'Email',
      accountOrg: 'Organization',
      accountSignIn: 'Sign-In',
      accountNotSignedIn: 'Not Signed In',
      accountLoading: 'Loading account…',
      codexNeedsProject: 'Open a project to view the Codex account',
      keyNameDuplicate: 'A key with this name already exists on this platform',
      deleteKeyTitle: 'Delete Key',
      deleteKeyDescription: 'Delete key "{{name}}"? This action cannot be undone.',
      setDefault: 'Set as Default',
      default: 'Default',
      defaultLabelClaude: 'Claude Code (Official)',
      defaultLabelCodex: 'Codex (Official)',
      defaultDescClaude: 'Uses system environment / Claude CLI auth',
      defaultDescCodex: 'Uses Codex session auth (ChatGPT login or API key)',
      empty: 'No third-party providers configured',
      emptyHint: 'Click "Add Provider" to add a third-party API',
      updateAvailable: 'Sync from Preset',
      official: 'Official',
      useForTitle: 'Use This Platform for',
      useForClaude: 'Claude',
      useForCodex: 'Codex',
      useForImage: 'Image Generation',
      useForVideo: 'Video Generation',
      useForTts: 'Text to Speech',
      useForAsr: 'Speech to Text',
      getKey: 'Get a Key',
      apiKeys: 'API Keys',
      keyLabel: 'Key Name',
      keyNameConflict: 'A key with this name already exists',
      notSet: 'Not Set',
      customName: 'Platform name (leave blank to auto-detect)',
      platformName: 'Platform name',
      refreshIcon: 'Update icon',
      baseUrl: 'Base URL',
      relayHint: 'Enter the site root or any /v1 URL. The site name and icon are filled in automatically. Then click Discover Models.',
      draftDiscoverHint: 'Fill in the base URL and API key, then click Discover Models.',
      discoverModelsDone: 'Models discovered — review the checked formats/capabilities and the model list below.',
      relayDetected: 'Detected {{kind}} — review the checked formats and model list below.',
      relayDetectedNamed: 'Detected {{kind}} ({{name}}) — review the checked formats and model list below.',
      relayKindNewApi: 'New API',
      relayKindOneApi: 'One API',
      relayKindSub2api: 'Sub2API',
      relayKindOpenaiCompatible: 'OpenAI-compatible',
      apiKey: 'API Key',
      formats: 'Compatible Formats',
      capabilities: 'Capabilities',
      familyAnthropic: 'Anthropic (Claude)',
      familyOpenai: 'OpenAI',
      familyNewapi: 'New API Video Relay (Seedance / Kling)',
      familyGoogle: 'Google (Gemini)',
      protocolOpenaiChatCompletion: 'Chat Completion',
      protocolOpenaiResponses: 'Chat Response',
      taskChat: 'Chat',
      taskImage: 'Image Generation',
      taskVideo: 'Video Generation',
      taskTts: 'Text-to-Speech',
      taskAsr: 'Speech-to-Text',
      defaultKeyName: 'Key',
      advanced: 'Advanced Settings',
      claudeBaseUrl: 'Base URL (Claude Compatible)',
      capabilitiesNeedKey: 'Select or add an API key to edit formats for that key.',
      capabilitiesPerKeyHint: 'Formats and capabilities are saved on the selected key, not shared across keys.',
      selectModel: 'Select a Model',
      modelNone: 'None',
      oneMillionHint: 'Enable the 1M-token context window (adds the [1m] suffix).',
    },
    providerDialog: {
      addTitle: 'Add Provider',
      addDescription: 'Select a provider template to get started',
      editDescription: 'Update provider configuration',
      name: 'Name',
      namePlaceholder: 'Provider Name',
      keyName: 'Key Name',
      keyNamePlaceholder: 'default',
      apiKey: 'API Key',
      getApiKey: 'Get API Key',
      envShow: 'Show Environment Variables',
      envHide: 'Hide Environment Variables',
      advancedShow: 'Show Advanced Options',
      advancedHide: 'Hide Advanced Options',
      baseUrl: 'Base URL',
      addVariable: 'Add Variable',
      pasteEnv: 'Paste .env',
      applyPaste: 'Apply',
      environmentVariables: 'Environment Variables',
      modelMapping: 'Model Mapping',
      imageCapability: 'Image Generation',
      mediaModels: 'Models',
      addModel: 'Add Model',
      modelIdPlaceholder: 'Model ID',
      modelNamePlaceholder: 'Display Name',
      bucketDefault: 'Default',
      bucketSubagent: 'Subagent',
      testing: 'Connecting...',
      fetchingModels: 'Fetching model list...',
      chatProbing: 'Model list OK, testing a real conversation...',
      connected: 'Connected ✓',
      connectedAll: 'All {{count}} endpoints connected ✓',
      connectionFailed: 'Connection failed',
      unknownError: 'Unknown error',
      noAgentConfig: 'No config for this agent',
      test: 'Connection Test',
      testEndpoint: 'Test',
      save: 'Save',
      delete: 'Delete',
      sync: 'Sync from Preset',
      syncTitle: 'Sync from {{name}} Preset',
      syncDescription: 'Pick what to sync. Newly added items are checked by default; items that differ from your current values are unchecked — enable them only if you want to override.',
      syncNoChanges: 'This provider already matches the preset exactly.',
      syncSupportedAgentsAdded: 'Newly Supported Agents',
      syncExtraEnvSection: 'Environment Variables',
      syncModelEnvSection: 'Model Mappings',
      syncBaseUrlSection: 'Base URL',
      syncEmptyPlaceholder: '<empty, filled by API key>',
      syncApply: 'Apply',
      models: {
        title: 'Models',
        count: '{{count}} models available',
        search: 'Search Models…',
        refresh: 'Fetch Models',
        released: 'Released {{date}}',
        knowledge: 'Knowledge {{date}}',
        maxOutput: 'Max Out',
        priceIn: 'In',
        priceOut: 'Out',
        empty: 'No models match.',
        noEntry: 'No models.dev catalog entry matched this platform. Configured model ids still work.',
        copied: 'Copied',
        all: 'All',
        chat: 'Chat',
        image: 'Image',
        video: 'Video',
        tts: 'TTS',
        asr: 'ASR',
        vision: 'Vision',
        tools: 'Tools',
        reasoning: 'Reasoning',
        enabledGroup: 'Enabled',
        disabledGroup: 'Disabled',
        lockedHint: 'Always on — used by your model mapping.',
        addCustom: 'Add Model',
        customGroup: 'Custom',
        usedFor: 'Used for',
        add: 'Add',
        duplicate: 'This model id already exists.',
        deleteCustom: 'Remove custom model',
        editModel: 'Edit model',
        discover: 'Discover Models',
        discoverError: 'Could not discover models: {{message}}',
        discoverEmpty: 'No models were discovered on this endpoint.',
        discoverTruncated: 'Showing the first 500 discovered models.',
        discoveredGroup: 'Discovered',
        enableAllDiscovered: 'Enable All',
        disableAllDiscovered: 'Disable All',
      },
    },
    mcp: {
      title: 'MCP Servers',
      subtitle: 'Manage Model Context Protocol server configurations',
      add: 'Add Server',
      refresh: 'Refresh',
      library: 'Library',
      statusDisabled: 'disabled',
      statusConnecting: 'connecting...',
      statusFailed: 'failed',
      toolsCount_one: '{{count}} tool',
      toolsCount_other: '{{count}} tools',
      empty: 'No MCP servers configured',
      emptyHintClaude: 'User: ~/.claude.json | Project: .claude/settings.json, .mcp.json',
      emptyHintCodex: 'User: ~/.codex/config.toml | Project: .codex/config.toml',
      claudeAiTitle: 'Claude.ai',
      claudeAiFetching: 'Fetching claude.ai servers...',
      claudeAiEmpty: 'No claude.ai MCP servers found',
      tools: 'Tools',
      noToolsConnected: 'No tools available',
      noToolsDisabled: 'Enable the server to see available tools',
      noToolsDisconnected: 'Connect the server to see available tools',
      form: {
        title: 'Add MCP Server',
        paste: 'Paste',
        pasteTooltip: 'Paste MCP server config from clipboard (JSON or URL)',
        name: 'Name',
        namePlaceholder: 'my-server',
        type: 'Type',
        command: 'Command',
        commandPlaceholder: 'npx',
        args: 'Args (space-separated)',
        argsPlaceholder: '-y @modelcontextprotocol/server-filesystem',
        env: 'Environment Variables',
        url: 'URL',
        urlPlaceholder: 'https://api.example.com/mcp',
        headers: 'Headers',
        scope: 'Scope',
        scopeUser: 'user',
        scopeProject: 'project',
        verifying: 'Verifying...',
        adding: 'Adding Server...',
        add: 'Add',
        verified: 'Verified',
        verificationFailed: 'Connection verification failed',
        clipboardInvalid: 'Clipboard does not contain a recognized MCP config',
        clipboardFailed: 'Failed to read clipboard',
        tabManual: 'Manual',
        tabBundle: 'Bundle (.mcpb)',
      },
      libraryView: {
        title: 'Add from Library',
        empty: 'No servers in library yet. Servers are saved automatically after a successful connection.',
        added: 'Added',
        addCount: 'Add {{count}} server',
        adding: 'Adding...',
        deleteButton: 'Delete',
        deleteTitle: 'Delete MCPs from Library?',
        deleteDescription: 'This will remove {{count}} selected server(s) from MCP library.',
        deleting: 'Deleting...',
        delete: 'Delete',
      },
      detail: {
        authTitle: 'Authorization Required',
        authDescription: 'This server requires OAuth authorization to connect.',
        authorizing: 'Authorizing...',
        authorize: 'Authorize',
        configuration: 'Configuration',
        edit: 'Edit',
        commandLabel: 'Command',
        argsLabel: 'Args',
        environmentLabel: 'Environment',
        urlLabel: 'URL',
        headersLabel: 'Headers',
        uninstallTitle: 'Uninstall',
        uninstallDescription: 'Remove this MCP server configuration. This cannot be undone.',
        confirmQuestion: 'Are you sure?',
        confirm: 'Confirm',
        uninstall: 'Uninstall Server',
        bundleBadge: 'Bundle v{{version}}',
        bundleReveal: 'Reveal',
      },
      bundle: {
        installButton: 'Install Bundle',
        dropToInstall: 'Drop .mcpb file to install',
        dropZoneTitle: 'Install from .mcpb Bundle',
        dropZoneHint: 'Drop a file here, or click to browse',
        notMcpbFile: 'Not a .mcpb file',
        installed: '{{name}} installed',
        dialogTitle: 'Install MCP Bundle',
        dialogDescription: 'Review what this bundle ships with, then choose where to install it.',
        readingBundle: 'Reading bundle…',
        cannotRead: 'Cannot read bundle',
        warningHeader: 'Heads Up',
        replaceExistingSameVersion: 'An installation already exists. Installing will reinstall it.',
        replaceExistingDifferentVersion: 'Replacing existing version {{version}}.',
        toolsSection: 'Tools',
        promptsSection: 'Prompts',
        toolsGenerated: '+ tools generated at runtime',
        scopeLabel: 'Install Scope',
        scopeUser: 'All Projects (User)',
        scopeProject: 'This Project Only',
        scopeHint: "Choose where this bundle's MCP server should be available.",
        configurationSection: 'Configuration',
        sensitiveBadge: 'Sensitive',
        requiredField: 'Required',
        cancel: 'Cancel',
        install: 'Install',
        installing: 'Installing…',
      },
    },
    plugins: {
      title: 'Plugins',
      subtitleClaude: 'Browse and manage Claude Code plugins',
      subtitleCodex: 'Browse and manage Codex plugins',
      tabMarketplace: 'Marketplaces',
      tabInstalled: 'Installed ({{count}})',
      emptyMarketplace: 'No marketplaces found',
      emptyMarketplaceHintClaude: 'Install a marketplace with: claude plugin marketplace add',
      emptyMarketplaceHintCodex: 'Install a marketplace with: codex marketplace add <source>',
      emptyInstalled: 'No plugins installed',
      emptyInstalledHintClaude: 'Browse the Marketplace to install Claude Code plugins',
      emptyInstalledHintCodex: 'Browse the Marketplace to install Codex plugins',
      updateAvailable: '{{count}} update(s) available',
      updateAll: 'Update All',
      updating: 'Updating...',
      update: 'Update',
      loading: 'Loading plugins…',
      searchPlaceholder: 'Search plugins...',
      searchNoMatch: 'No plugins match your search',
      marketplaceEmpty: 'No plugins in this marketplace',
      addMarketplace: 'Add Marketplace',
      addMarketplaceTitle: 'Add a Marketplace',
      addMarketplaceDesc: 'Connect a marketplace by GitHub repo, URL, or local path.',
      addMarketplaceSourceLabel: 'Source',
      addMarketplaceSourcePlaceholder: 'owner/repo, https://…, or /absolute/path',
      addMarketplaceSourceHint: 'Examples: anthropics/claude-plugins-official, https://example.com/marketplace.git, /Users/me/my-marketplace',
      addMarketplaceScopeLabel: 'Scope',
      removeMarketplace: 'Remove',
      removeMarketplaceTitle: 'Remove this marketplace?',
      removeMarketplaceDesc: 'This unregisters "{{name}}" from {{scope}} settings. Already-installed plugins from it remain installed.',
      add: 'Add',
      adding: 'Adding…',
      removing: 'Removing…',
      scope: {
        user: 'User',
        project: 'Project',
      },
      marketplaceScope: {
        user: 'User',
        project: 'Project',
        local: 'Local',
        official: 'Built-in',
      },
      detail: {
        apps: 'Apps',
        needsAuth: 'Needs Auth',
        install: 'Install',
        skills: 'Skills',
        disabled: 'Disabled',
        screenshots: 'Screenshots',
        overview: 'Overview',
        metadata: 'Metadata',
        capabilities: 'Capabilities',
        mcpServers: 'MCP Servers',
        links: 'Links',
        website: 'Website',
        privacy: 'Privacy',
        terms: 'Terms',
        starterPrompts: 'Starter Prompts',
        noFiles: 'No resources in this plugin',
        selectResource: 'Select a resource to preview',
        emptyFolder: 'Empty Folder',
        referencedScripts: 'Referenced Scripts',
      },
      capability: {
        commands: 'Commands',
        agents: 'Agents',
        skills: 'Skills',
        hooks: 'Hooks',
        mcp: 'MCP',
        other: 'Other',
      },
    },
    hooks: {
      title: 'Hooks',
      subtitle: 'Configure custom commands, prompts, or HTTP requests that fire on tool use, user submit, session lifecycle, and other events',
      add: 'Add Hook',
      empty: 'No hooks configured',
      emptyHint: 'Click "Add Hook" to create one. Hooks are stored in settings.json',
      applyNote: 'Changes apply to **new sessions** only. Currently running sessions are not affected.',
      entryCount_one: '{{count}} entry',
      entryCount_other: '{{count}} entries',
      deleteTitle: 'Delete this hook?',
      deleteDescription: 'This removes the hook from settings.json. Cannot be undone.',
      scope: {
        user: 'User',
        project: 'Project',
        local: 'Local',
      },
      types: {
        command: 'Command',
        prompt: 'Prompt',
        agent: 'Agent',
        http: 'HTTP',
        mcp_tool: 'MCP Tool',
      },
      editor: {
        titleNew: 'New Hook',
        titleEdit: 'Edit Hook',
        subtitle: 'Saves to settings.json at the chosen scope',
        advanced: 'Advanced',
        eventGroup: {
          common: 'Common',
          more: 'More',
        },
        fields: {
          scope: 'Scope',
          event: 'Event',
          matcher: 'Matcher',
          matcherHint: 'Permission rule syntax. Hook only fires when the tool call matches. e.g. Bash(git push *)',
          type: 'Type',
          command: 'Command',
          shell: 'Shell',
          shellAuto: 'Auto',
          async: 'Async',
          asyncHint: 'Run in background, do not block the main thread',
          asyncRewake: 'Async Rewake',
          asyncRewakeHint: 'Background run; exit code 2 wakes the model (implies async)',
          prompt: 'Prompt',
          promptHint: 'Use $ARGUMENTS as a placeholder for the hook input JSON',
          model: 'Model (Optional)',
          url: 'URL',
          headers: 'Headers (JSON)',
          headersHint: 'Reference env vars with $VAR_NAME (must be listed in allowedEnvVars)',
          allowedEnvVars: 'Allowed Env Vars',
          allowedEnvVarsHint: 'Comma-separated. Only these vars get interpolated into headers',
          mcpServer: 'MCP Server',
          mcpTool: 'Tool Name',
          mcpInput: 'Tool Input (JSON)',
          mcpInputHint: 'String values support ${path} interpolation (e.g. "${tool_input.file_path}")',
          ifHint: 'Permission-rule syntax for secondary filtering',
          timeout: 'Timeout (Seconds)',
          statusMessage: 'Status Message',
          once: 'Run Once',
          onceHint: 'Auto-removes from config after firing',
        },
      },
      errors: {
        commandRequired: 'Command is required',
        promptRequired: 'Prompt is required',
        urlRequired: 'URL is required',
        mcpToolRequired: 'Server and tool name are required',
        invalidTimeout: 'Timeout must be a positive number',
        headersJson: 'Headers must be a valid JSON object',
        toolInputJson: 'Tool input must be a valid JSON object',
      },
    },
    codexHooks: {
      title: 'Codex Hooks',
      subtitle: 'Hooks discovered by the Codex app-server for this project. Edit them by changing your Codex config or installed plugins.',
      readOnlyNote: 'Read-only view. To add or change Codex hooks, edit ~/.codex/ or the source plugin directly.',
      empty: 'No Codex hooks discovered',
      emptyHint: 'Hooks come from Codex config (~/.codex/config.toml) or installed plugins',
      source: {
        user: 'User',
        project: 'Project',
        managed: 'Managed',
        plugin: 'Plugin',
        unknown: 'Unknown',
      },
    },
    schedule: {
      label: 'Schedule',
      simple: 'Simple',
      advanced: 'Advanced',
      preset: {
        once: 'once',
        hourly: 'hourly',
        daily: 'daily',
        weekly: 'weekly',
      },
      pickDate: 'Pick a date',
      atMinute: 'At minute',
      pastHour: 'past the hour',
      time: 'Time',
      cronExpression: 'Cron Expression',
      nextRuns: '→ Next: {{runs}}',
      days: {
        mon: 'Mon',
        tue: 'Tue',
        wed: 'Wed',
        thu: 'Thu',
        fri: 'Fri',
        sat: 'Sat',
        sun: 'Sun',
      },
    },
    automation: {
      editTitle: 'Edit Automation',
      createTitle: 'Create Automation',
      editDescription: 'Update scheduled task configuration',
      createDescription: 'Set up a scheduled task for this project',
      name: 'Name',
      namePlaceholder: 'Daily code review',
      provider: 'Provider',
      prompt: 'Prompt',
      promptPlaceholder: 'Review recent commits and suggest improvements...',
      enabled: 'Enabled',
      enabledOn: 'Scheduler will run this automation',
      enabledOff: 'Paused — will not run on schedule',
      agentSettingsShow: 'Show agent settings',
      agentSettingsHide: 'Hide agent settings',
      select: 'Select',
      defaultValue: 'Default',
      fullAccess: 'Full Access',
      readOnly: 'Read-Only',
      approveForMe: 'Approve for Me',
      defaultDesc: 'Codex automatically runs commands in a sandbox',
      fullAccessDesc: 'Codex has full access over your computer (elevated risk)',
      readOnlyDesc: 'Codex can only read files; no edits or commands',
      approveForMeDesc: 'Codex reviews actions that need elevated permissions',
      model: 'Model',
      effort: 'Effort',
      permission: 'Permission',
      sandbox: 'Sandbox',
      reasoning: 'Reasoning',
      save: 'Save',
      create: 'Create',
    },
    remote: {
      title: 'Remote Control',
      subtitle: 'Allow a mobile device to monitor and control this SuperOne instance.',
      enableLabel: 'Allow Control',
      enableDescription: 'Expose this device for remote pairing',
      preventSleepLabel: 'Prevent System Sleep',
      preventSleepDescription: 'Prevent idle sleep when the screen is open. Does not apply when the lid is closed.',
      pairNewDevice: 'Pair New Device',
      pairNewPhone: 'Pair New Phone',
      pairNewDesktop: 'Pair New Desktop',
      pairTitle: 'Pair a New Phone',
      stepScan: 'Open SuperOne on your phone and scan this QR code',
      stepCode: 'Enter the 6-digit code shown on your phone',
      copyLink: 'Copy Pairing Link',
      linkCopied: 'Pairing link copied',
      codePrompt: 'Enter the 6-digit code shown on',
      confirming: 'Confirming…',
      confirm: 'Confirm',
      codeError: 'Incorrect code. Please check your phone and try again.',
      sessionExpired: 'Pairing session expired. Please try again.',
      alreadyPaired: '{{name}} is already paired with this device.',
      paired: 'Paired Devices',
      noPaired: 'No paired devices.',
      online: 'Online',
      lastSeen: 'Last seen {{date}}',
      neverConnected: 'Never connected',
      remove: 'Remove',
      customRelay: 'Custom Relay Server',
      deployCloudflare: 'Deploy to Cloudflare',
      checking: 'Checking…',
      test: 'Test',
      relayConnected: 'Connected',
      relayUnreachable: 'Unreachable',
      relayHint: 'Override the default relay with your own Cloudflare Workers deployment. Leave empty to use the built-in relay.',
      statusRelay: 'Relay',
      statusLan: 'LAN',
      statusLanActive: 'Active',
      statusLanInactive: 'Inactive',
      statusRelayConnected: 'Connected',
      statusRelayDisconnected: 'Disconnected',
    },
    apps: {
      title: 'Mini Apps',
      subtitle: 'Manage installed apps and tool preapproval settings',
      loading: 'Loading...',
      empty: 'No mini apps installed',
      emptyHint: 'Drop .s1app files in the sidebar to install',
      noTools: 'No tools',
      toolCount_one: '{{count}} tool',
      toolCount_other: '{{count}} tools',
      sections: { personal: 'Personal', project: 'Project' },
      preapprovalTitle: 'Tool Pre-approval',
      preapprovalDescription: 'Enabled tools skip permission prompts when the agent uses them.',
      noAppTools: 'This app has no tools.',
      permissions: 'Permissions',
      uninstallTitle: 'Uninstall',
      uninstallDescription: 'Remove this app and all its data. This cannot be undone.',
      uninstallDevDescription: 'Unregister this dev app and remove its data. Your source code stays on disk.',
      confirmQuestion: 'Are you sure?',
      confirm: 'Confirm',
      uninstall: 'Uninstall App',
      uninstalled: 'Uninstalled {{name}}',
      uninstallFailed: 'Uninstall failed',
      authorBy: 'by {{name}}',
      readOnly: 'Read Only',
      readWrite: 'Read & Write',
      network: 'Network',
      dropHint: {
        left: 'Split left',
        right: 'Split right',
        top: 'Split up',
        bottom: 'Split down',
        center: 'Open here',
      },
    },
    devAppLibrary: {
      toggleButton: 'Dev Apps',
      title: 'Dev Apps',
      addNew: 'Add Dev App…',
      loading: 'Loading…',
      empty: 'No dev apps registered yet',
      emptyHint: 'Use “Add Dev App…” to register a source directory, or run miniapp_dev_register from an agent.',
      added: 'Added {{name}} to Dev Apps',
      addFailed: 'Failed to add dev app',
      installedHere: 'installed',
      missingBadge: 'missing',
      orphanBadge: 'unlinked',
      installScopeUser: 'User',
      installScopeProject: 'In {{name}}',
      revealSource: 'Reveal Source in Finder',
      installTo: 'Install To',
      scopeUser: 'User (All Projects)',
      scopeProject: 'Project: {{name}}',
      scopeProjectNone: 'Project (None Open)',
      installCount: 'Install {{count}}',
      installing: 'Installing…',
      installedCount: 'Installed {{count}} dev app(s)',
      noProjectSelected: 'Open a project first to install at project scope',
      removeButton: 'Remove {{count}}',
      removeTitle: 'Remove from Dev Apps',
      removeDescription: 'Remove {{count}} entry from the dev registry? Source files stay on disk.',
      removeCascadeLabel: 'Also uninstall .s1-dev.json pointers from all scopes',
      remove: 'Remove',
      removing: 'Removing…',
      removedCount: 'Removed {{count}} entry(s)',
    },
  },
  widget: {
    save: {
      title: 'Save as template',
      updateTitle: 'Update template',
      description: 'Saved templates can be re-rendered later without regenerating the code.',
      namePlaceholder: 'Template name',
      descriptionPlaceholder: 'When should this be reused?',
      scopeProject: 'Project',
      scopeUser: 'Personal',
      scopeProjectHint: 'Stored in the project and shareable through git.',
      scopeUserHint: 'Available in every project on this machine.',
      staticHint: 'Saved without a data schema, so it will re-render exactly as shown.',
      confirm: 'Save',
      saved: 'Saved template "{{id}}"',
      failed: 'Could not save template: {{error}}',
    },
  },
  tooltips: {
    toggleSidebar: 'Toggle Sidebar',
    moveChatLeft: 'Move Chat to Left',
    moveChatRight: 'Move Chat to Right',
    toggleActivityPanel: 'Toggle Activity Panel',
    maximizeActivityPanel: 'Maximize Activity Panel',
    restoreActivityPanel: 'Restore Activity Panel',
    toggleTerminal: 'Toggle Terminal',
    closeBrowser: 'Close browser',
    closeMiniApp: 'Close mini-app',
    returnToPanel: 'Return to panel',
    expandToPlainText: 'Expand to plain text',
    save: 'Save ({{shortcut}})',
    newAutomation: 'New Automation',
    newSession: 'New Session',
    folderNotFound: 'Folder not found: {{path}}',
    rewind: 'Rewind',
    fork: 'Fork from here',
    collapsePermission: 'Collapse permission request (<kbd>space</kbd> to toggle)',
    worktree: 'Worktree',
    local: 'Local',
    createWorktreeFrom: 'Create worktree from {{branch}}',
    mermaidPreview: 'Preview',
    mermaidSource: 'Source',
    expand: 'Expand',
    fastMode: 'Fast mode: {{state}}',
    selectModel: 'Select Model',
    thinkingEffort: 'Thinking Effort',
    effortFromEnv: 'Effort level is set by provider environment (CLAUDE_CODE_EFFORT_LEVEL)',
    reasoningEffort: 'Reasoning Effort',
    exitPlanMode: 'Exit plan mode',
    reload: 'Reload',
    openDevTools: 'Open DevTools',
    devTools: 'DevTools',
    saveAsHtml: 'Save as HTML',
    copyPlan: 'Copy plan',
    close: 'Close',
    fullscreen: 'Fullscreen',
    unsavedChanges: 'Unsaved changes',
    maximize: 'Maximize',
    sessionGrid: 'Session grid',
  },
  usageGauge: {
    claudeTitle: 'Claude Usage',
    codexTitle: 'Codex Usage',
    windowFallback: 'Usage',
    percentLeft: '{{percent}}% left',
    resetsSoon: 'resets soon',
    resetsIn: 'resets in {{time}}',
    extraUsage: 'Extra usage',
    creditBalance: 'Credit balance',
    resetCredits: 'Reset credits',
    resetCreditDefault: 'Reset credit',
    resetCreditExpires: 'Expires {{date}}',
    resetNow: 'Reset now',
    resetting: 'Resetting…',
    lifetimeTokens: 'Lifetime tokens',
    peakDaily: 'Peak daily',
    streak: 'Streak',
    updating: 'Updating…',
    updatedJustNow: 'Updated just now',
    updatedMinutesAgo: 'Updated {{n}}m ago',
    updatedHoursAgo: 'Updated {{n}}h ago',
    updatedDaysAgo: 'Updated {{n}}d ago',
    rateLimit: {
      approaching: 'Approaching rate limit',
      limited: 'Rate limited',
      percentUsed: '{{percent}}% used',
      resetsAt: 'resets at {{time}}',
    },
    toast: {
      reset: 'Rate limit reset',
      nothingToReset: 'No active rate limit to reset',
      noCredit: 'No reset credits available',
      alreadyRedeemed: 'This reset was already redeemed',
      unknown: 'Reset failed',
    },
  },
}
