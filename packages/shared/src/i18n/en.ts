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
    continue: string
    terminal: string
  }
  sidebar: {
    newSession: string
    tabs: {
      sessions: string
      files: string
    }
    pinned: string
    projects: string
    sort: {
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
      searchSessions: string
      rename: string
      renameFile: string
      pin: string
      unpin: string
      hide: string
      unhide: string
      copySessionId: string
      copyWorkingDirectory: string
      openFolder: string
      openInMiniWindow: string
      dragToMiniWindow: string
      forkToWorktree: string
      forkToLocal: string
      forkingToast: string
      forkedToast: string
      forkedLocalToast: string
      sessionIdCopiedToast: string
      sessionIdNotReadyToast: string
      workingDirCopiedToast: string
      addToChat: string
      copyPath: string
      copyRelativePath: string
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
    setup: {
      required: { title: string; description: string }
      installing: { title: string; description: string }
      success: { title: string; description: string }
      error: { title: string; description: string }
      install: string
    }
    update: {
      checking: string
      preparing: string
      upToDate: string
      downloading: string
      downloadingWithProgress: string
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
        apps: string
        remote: string
        usage: string
        mediaGen: string
        providers: string
        agents: string
        skills: string
        mcp: string
        hooks: string
        plugins: string
        preferences: string
      }
      providers: {
        claude: string
        codex: string
      }
    }
    appearance: {
      title: string
      subtitle: string
      interface: string
    }
    browser: {
      title: string
      subtitle: string
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
      }
      summary: {
        totalTokens: string
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
        input: string
        output: string
        cacheRead: string
        cacheCreation: string
      }
    }
  }
  chat: {
    placeholder: {
      addInstructions: string
      codexPlan: string
      codexReject: string
      codexAsk: string
      claudePlan: string
      claudeAsk: string
    }
    dropToAttach: string
    permissionModeTitle: string
    sandboxModeTitle: string
    permissionModes: {
      default: { label: string; description: string }
      acceptEdits: { label: string; description: string }
      auto: { label: string; description: string }
      plan: { label: string; description: string }
      dontAsk: { label: string; description: string }
      bypassPermissions: { label: string; description: string }
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
      followUp: string
      modelFallback: string
      permissionPreset: string
      goal: {
        title: string
        description: string
        noThread: string
        placeholder: string
        save: string
        clear: string
        status: string
      }
    }
    image: {
      copyImage: string
      copyPrompt: string
      openFolder: string
      addToChat: string
      copied: string
      promptCopied: string
      copyFailed: string
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
      generatingImage: string
      generatedImage: string
      listingMediaProviders: string
      listedMediaProviders: string
      mediaProvidersMatched: string
      settingUpMiniApp: string
      setUpMiniApp: string
      setUpMiniAppFailed: string
      setupFields: {
        directory: string
        description: string
        appId: string
      }
      packing: string
      miniAppPacked: string
      generatingWidget: string
      generateWidget: string
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
      browser: {
        navigate: string
        open: string
        snapshot: string
        query: string
        inspect: string
        screenshot: string
        click: string
        hover: string
        type: string
        press: string
        scroll: string
        drag: string
        select: string
        waitFor: string
        evaluate: string
        tabs: string
        resize: string
        networkStart: string
        networkStop: string
        networkWait: string
        networkBody: string
        cookies: string
        uploadFile: string
        emulate: string
        mock: string
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
    }
    slashCommand: {
      groupCommands: string
      groupSkills: string
    }
    mentionPopup: {
      groupAgents: string
      groupMiniApps: string
      groupFiles: string
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
      baseUrl: string
      apiKey: string
      formats: string
      capabilities: string
      familyAnthropic: string
      familyOpenai: string
      familyGoogle: string
      taskChat: string
      taskImage: string
      taskVideo: string
      taskTts: string
      taskAsr: string
      defaultKeyName: string
      advanced: string
      claudeBaseUrl: string
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
      connectionFailed: string
      unknownError: string
      noAgentConfig: string
      test: string
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
      defaultDesc: string
      fullAccessDesc: string
      readOnlyDesc: string
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
  tooltips: {
    toggleSidebar: string
    moveChatLeft: string
    moveChatRight: string
    toggleActivityPanel: string
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
    toggleTheme: string
  }
  usageGauge: {
    claudeTitle: string
    codexTitle: string
    windowFallback: string
    percentLeft: string
    resetsSoon: string
    resetsIn: string
    extraUsage: string
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
    continue: 'Continue',
    terminal: 'Terminal',
  },
  sidebar: {
    newSession: 'New Session',
    tabs: {
      sessions: 'Sessions',
      files: 'Files',
    },
    pinned: 'Pinned',
    projects: 'Projects',
    sort: {
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
      searchSessions: 'Search sessions…',
      rename: 'Rename Session',
      renameFile: 'Rename',
      pin: 'Pin Session',
      unpin: 'Unpin Session',
      hide: 'Hide Session',
      unhide: 'Unhide Session',
      copySessionId: 'Copy Session ID',
      copyWorkingDirectory: 'Copy Working Directory',
      openFolder: 'Open Folder',
      openInMiniWindow: 'Open in Mini Window',
      dragToMiniWindow: 'Release to open as mini window',
      forkToWorktree: 'Fork to New Worktree',
      forkToLocal: 'Fork to Local',
      forkingToast: 'Forking session…',
      forkedToast: 'Forked to a new worktree',
      forkedLocalToast: 'Forked in the current folder',
      sessionIdCopiedToast: 'Session ID Copied',
      sessionIdNotReadyToast: 'Session ID not ready — copied internal id',
      workingDirCopiedToast: 'Working Directory Copied',
      addToChat: 'Add to Chat',
      copyPath: 'Copy Path',
      copyRelativePath: 'Copy Relative Path',
    },
    appDrawer: {
      buildYourOwn: 'Build Your Own',
      marketplace: 'Marketplace',
      buildAppPrompt: 'Help me build a mini app for SuperOne. First call the `miniapp_dev_read_guide` tool (via the `superone` MCP server) to load the development guide, then guide me through the process step by step.',
    },
  },
  shell: {
    startup: {
      title: 'Super One',
      tagline: 'The one, the only!',
      openProject: 'Open Project',
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
      preparing: 'Preparing update {{version}}...',
      upToDate: "You're up to date",
      downloading: 'Downloading {{version}}...',
      downloadingWithProgress: 'Downloading {{version}}... {{progress}}%',
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
        apps: 'Mini Apps',
        remote: 'Remote Control',
        usage: 'Usage Stats',
        mediaGen: 'Image Gen',
        providers: 'AI Provider',
        agents: 'Subagents',
        skills: 'Skills',
        mcp: 'MCP Servers',
        hooks: 'Hooks',
        plugins: 'Plugins',
        preferences: 'Preference',
      },
      providers: {
        claude: 'Claude Code',
        codex: 'Codex',
      },
    },
    appearance: {
      title: 'Appearance',
      subtitle: 'Customize the look and feel of SuperOne',
      interface: 'Interface',
    },
    browser: {
      title: 'Browser',
      subtitle: 'Configure the built-in browser and its automation tools',
      cdp: {
        label: 'Chrome DevTools Protocol (CDP)',
        description: 'Routes the built-in browser tools to their CDP implementation, and unlocks the file-upload tool.',
      },
      experimental: {
        title: 'Experimental tools',
        description: 'These browser tools are experimental and off by default. Enable each individually — when off, the tool is not exposed to the agent at all.',
        requiresCdp: 'Requires CDP to be enabled.',
        cookies: {
          label: 'Cookie reading',
          description: 'Let the agent read the page cookies, including httpOnly session cookies. Values are truncated, but this still exposes login credentials to the model.',
        },
        emulate: {
          label: 'Device emulation',
          description: 'Let the agent override viewport size, device scale, mobile mode, user agent, color scheme, timezone, locale, and geolocation for the page. Overrides persist until reset or the tab is closed.',
        },
        mock: {
          label: 'Network mocking',
          description: 'Let the agent intercept and modify requests and responses — including login credentials and cookies. Only enable in trusted scenarios; misuse can hang pages (reload the tab to recover).',
        },
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
      uiFont: {
        label: 'Interface Font',
        description: 'Font for the app interface, from fonts installed on your system.',
      },
      font: {
        systemDefault: 'System default',
      },
      analytics: {
        label: 'Usage Analytics',
        description: 'Send anonymous usage data to help improve SuperOne. No personal data or conversation content is collected.',
        enabled: 'Analytics enabled',
        disabled: 'Analytics disabled',
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
        system: 'Follow system',
        english: 'English',
        chinese: '中文',
        updated: 'Language updated',
      },
      appIcon: {
        label: 'App Icon',
        description: 'Use a custom icon for the Dock and taskbar. The icon shown in Launchpad updates after a restart.',
        choose: 'Choose…',
        reset: 'Reset to default',
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
    },
    preferences: {
      title: 'Preferences',
      claudeSubtitle: 'Configure Claude Code behavior',
      codexSubtitle: 'Configure Codex defaults for new sessions',
      import: {
        section: 'Migration',
        label: 'Import from other agents',
        description: 'Detect and import AGENTS.md, MCP servers, skills, and more from other AI agents.',
        detect: 'Detect',
        detecting: 'Detecting…',
        none: 'No importable configuration found',
        dialogTitle: 'Import agent configuration',
        dialogDescription: 'Found {{count}} item(s) to import into Codex.',
        confirm: 'Import',
        importing: 'Importing…',
        done: 'Imported {{success}} item(s), {{failure}} failed',
        error: 'Import failed',
      },
      sections: { project: 'Project Settings', user: 'User Settings' },
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
        installHintTitle: 'Install command',
        probeNow: 'Check now',
        reProbe: 'Re-check',
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
        '7d': 'Last 7 days',
        '30d': 'Last 30 days',
        '90d': 'Last 90 days',
        all: 'All time',
      },
      harness: {
        all: 'All',
        claude: 'Claude',
        codex: 'Codex',
      },
      summary: {
        totalTokens: 'Total Tokens',
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
        input: 'Input',
        output: 'Output',
        cacheRead: 'Cache Read',
        cacheCreation: 'Cache Creation',
      },
    },
  },
  chat: {
    placeholder: {
      addInstructions: 'Add instructions...',
      codexPlan: "Let's make a plan! What's in your mind?",
      codexReject: 'Tell Codex what to do differently',
      codexAsk: 'Ask Codex anything, @ for files & mini-apps, / for commands and skills',
      claudePlan: "Let's make a plan! What's in your mind?",
      claudeAsk: 'Ask Claude anything, @ for files, agents & mini-apps, / for commands and skills',
    },
    dropToAttach: 'Drop images or PDFs to attach',
    permissionModeTitle: 'Permission Mode',
    sandboxModeTitle: 'Sandbox Mode',
    permissionModes: {
      default: { label: 'Normal', description: 'Prompts for dangerous operations' },
      acceptEdits: { label: 'Accept Edits', description: 'Auto-accept file edit operations' },
      auto: { label: 'Auto', description: 'Model classifier decides each permission' },
      plan: { label: 'Plan Mode', description: 'Planning only, no actual execution' },
      dontAsk: { label: "Don't Ask", description: 'Deny anything not pre-approved' },
      bypassPermissions: { label: 'Bypass', description: 'Bypass all permission checks' },
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
      waitingFor: 'Waiting for {{name}}...',
      waitingForWithElapsed: 'Waiting for {{name}} for {{elapsed}}s...',
      fallbackAgentName: 'subagent',
      codexError: 'Codex Error',
      startReview: 'Start review',
      reviewComplete: 'Review complete',
      conversationCompacted: 'Conversation compacted',
      followUp: 'Follow-up',
      modelFallback: 'Codex model',
      permissionPreset: 'Permission Preset',
      goal: {
        title: 'Codex Goal',
        description: 'Anchor what this Codex thread is trying to achieve. The model uses it to keep turns on track.',
        noThread: 'Start a Codex session first (send a message), then come back to set a goal.',
        placeholder: 'e.g. Refactor the auth middleware to use JWT and ship behind the legacy flag',
        save: 'Save goal',
        clear: 'Clear goal',
        status: 'Status: {{status}}',
      },
    },
    image: {
      copyImage: 'Copy Image',
      copyPrompt: 'Copy Prompt',
      openFolder: 'Open Folder',
      addToChat: 'Add to Chat',
      copied: 'Image copied to clipboard',
      promptCopied: 'Prompt copied to clipboard',
      copyFailed: 'Copy failed: {{error}}',
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
      handoffHeading: 'Hand off changes to Local',
      handoffInfo: "Copy this worktree's changes into the local folder.",
      handoffButton: 'Hand off',
      handoffSuccess: 'Changes handed off to Local',
      handoffErrorNoChanges: 'Nothing to hand off',
      handoffErrorLocalDirty: 'The local folder has uncommitted changes — commit or stash them first',
      handoffErrorConflict: 'Changes conflict with the local folder — nothing was handed off',
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
      readWidgetGuidelines: 'Read widget guidelines',
      readingMiniAppGuide: 'Reading mini-app guide',
      readMiniAppGuide: 'Read mini-app guide',
      generatingImage: 'Generating image',
      generatedImage: 'Generated image',
      listingMediaProviders: 'List providers',
      listedMediaProviders: 'List providers',
      mediaProvidersMatched: '{{count}} matched',
      settingUpMiniApp: 'Setting up mini-app',
      setUpMiniApp: 'Set up mini-app',
      setUpMiniAppFailed: 'Mini-app setup failed',
      setupFields: {
        directory: 'Directory',
        description: 'Description',
        appId: 'App ID',
      },
      packing: 'Packing…',
      miniAppPacked: 'Mini-app packed',
      generatingWidget: 'Generating widget…',
      generateWidget: 'Generate widget',
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
      browser: {
        navigate: 'Navigate',
        open: 'Open tab',
        snapshot: 'Snapshot',
        query: 'Query',
        inspect: 'Inspect',
        screenshot: 'Screenshot',
        click: 'Click',
        hover: 'Hover',
        type: 'Type',
        press: 'Press',
        scroll: 'Scroll',
        drag: 'Drag',
        select: 'Select',
        waitFor: 'Wait for',
        evaluate: 'Evaluate',
        tabs: 'Tabs',
        resize: 'Resize',
        networkStart: 'Record network',
        networkStop: 'Collect network',
        networkWait: 'Wait for request',
        networkBody: 'Response body',
        cookies: 'Cookies',
        uploadFile: 'Upload file',
        emulate: 'Emulate',
        mock: 'Mock',
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
        notFound: 'not found',
        viewport: 'viewport',
        screenshotUnavailable: 'Screenshot no longer available',
        code: 'Code',
        result: 'Result',
        mockUrl: 'URL',
        mockStatus: 'Status',
        mockContentType: 'Content-Type',
        mockBody: 'Body',
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
    },
    slashCommand: {
      groupCommands: 'Commands',
      groupSkills: 'Skills',
    },
    mentionPopup: {
      groupAgents: 'Agents',
      groupMiniApps: 'Mini apps',
      groupFiles: 'Files',
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
      hideFromAgent: 'Hide from agent',
      showToAgent: 'Show to agent',
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
      defaultImageProviderLabel: 'Default image provider',
      defaultImageProviderDescription: 'Used by the image tool when no provider is specified. Its first enabled model is the default.',
      defaultImageProviderAuto: 'Auto (first usable)',
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
      customName: 'Platform Name',
      baseUrl: 'Base URL',
      apiKey: 'API Key',
      formats: 'Compatible formats',
      capabilities: 'Capabilities',
      familyAnthropic: 'Anthropic (Claude)',
      familyOpenai: 'OpenAI',
      familyGoogle: 'Google (Gemini)',
      taskChat: 'Chat',
      taskImage: 'Image generation',
      taskVideo: 'Video generation',
      taskTts: 'Text-to-speech',
      taskAsr: 'Speech-to-text',
      defaultKeyName: 'Key',
      advanced: 'Advanced Settings',
      claudeBaseUrl: 'Base URL (Claude Compatible)',
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
      connectionFailed: 'Connection failed',
      unknownError: 'Unknown error',
      noAgentConfig: 'No config for this agent',
      test: 'Connection Test',
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
        installButton: 'Install bundle',
        dropToInstall: 'Drop .mcpb file to install',
        dropZoneTitle: 'Install from .mcpb bundle',
        dropZoneHint: 'Drop a file here, or click to browse',
        notMcpbFile: 'Not a .mcpb file',
        installed: '{{name}} installed',
        dialogTitle: 'Install MCP Bundle',
        dialogDescription: 'Review what this bundle ships with, then choose where to install it.',
        readingBundle: 'Reading bundle…',
        cannotRead: 'Cannot read bundle',
        warningHeader: 'Heads up',
        replaceExistingSameVersion: 'An installation already exists. Installing will reinstall it.',
        replaceExistingDifferentVersion: 'Replacing existing version {{version}}.',
        toolsSection: 'Tools',
        promptsSection: 'Prompts',
        toolsGenerated: '+ tools generated at runtime',
        scopeLabel: 'Install scope',
        scopeUser: 'All projects (user)',
        scopeProject: 'This project only',
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
        needsAuth: 'Needs auth',
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
        emptyFolder: 'Empty folder',
        referencedScripts: 'Referenced scripts',
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
          asyncRewake: 'Async rewake',
          asyncRewakeHint: 'Background run; exit code 2 wakes the model (implies async)',
          prompt: 'Prompt',
          promptHint: 'Use $ARGUMENTS as a placeholder for the hook input JSON',
          model: 'Model (optional)',
          url: 'URL',
          headers: 'Headers (JSON)',
          headersHint: 'Reference env vars with $VAR_NAME (must be listed in allowedEnvVars)',
          allowedEnvVars: 'Allowed env vars',
          allowedEnvVarsHint: 'Comma-separated. Only these vars get interpolated into headers',
          mcpServer: 'MCP server',
          mcpTool: 'Tool name',
          mcpInput: 'Tool input (JSON)',
          mcpInputHint: 'String values support ${path} interpolation (e.g. "${tool_input.file_path}")',
          ifHint: 'Permission-rule syntax for secondary filtering',
          timeout: 'Timeout (seconds)',
          statusMessage: 'Status message',
          once: 'Run once',
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
      defaultDesc: 'Codex automatically runs commands in a sandbox',
      fullAccessDesc: 'Codex has full access over your computer (elevated risk)',
      readOnlyDesc: 'Codex can only read files; no edits or commands',
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
      enableLabel: 'Enable Remote Control',
      enableDescription: 'Expose this device for remote pairing',
      preventSleepLabel: 'Prevent System Sleep',
      preventSleepDescription: 'Prevent idle sleep when the screen is open. Does not apply when the lid is closed.',
      pairNewDevice: 'Pair New Device',
      pairTitle: 'Pair a New Device',
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
      readOnly: 'Read only',
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
      addNew: 'Add dev app…',
      loading: 'Loading…',
      empty: 'No dev apps registered yet',
      emptyHint: 'Use “Add dev app…” to register a source directory, or run miniapp_dev_register from an agent.',
      added: 'Added {{name}} to Dev Apps',
      addFailed: 'Failed to add dev app',
      installedHere: 'installed',
      missingBadge: 'missing',
      orphanBadge: 'unlinked',
      installScopeUser: 'User',
      installScopeProject: 'In {{name}}',
      revealSource: 'Reveal source in Finder',
      installTo: 'Install to',
      scopeUser: 'User (all projects)',
      scopeProject: 'Project: {{name}}',
      scopeProjectNone: 'Project (none open)',
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
  tooltips: {
    toggleSidebar: 'Toggle Sidebar',
    moveChatLeft: 'Move Chat to Left',
    moveChatRight: 'Move Chat to Right',
    toggleActivityPanel: 'Toggle Activity Panel',
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
    toggleTheme: 'Toggle theme',
  },
  usageGauge: {
    claudeTitle: 'Claude Usage',
    codexTitle: 'Codex Usage',
    windowFallback: 'Usage',
    percentLeft: '{{percent}}% left',
    resetsSoon: 'resets soon',
    resetsIn: 'resets in {{time}}',
    extraUsage: 'Extra usage',
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
    toast: {
      reset: 'Rate limit reset',
      nothingToReset: 'No active rate limit to reset',
      noCredit: 'No reset credits available',
      alreadyRedeemed: 'This reset was already redeemed',
      unknown: 'Reset failed',
    },
  },
}
