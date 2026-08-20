import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'core/l10n.dart';
import 'core/logger.dart';
import 'core/theme.dart';
import 'screens/home_shell.dart';
import 'services/module_manager.dart';
import 'services/storage_service.dart';
import 'services/subscription_manager.dart';
import 'services/vpn_engine.dart';
import 'state/settings_controller.dart';

/// Корень приложения: провайдеры + локализация + тема.
class NexusApp extends StatelessWidget {
  const NexusApp({
    super.key,
    required this.settings,
    required this.modules,
    required this.subscriptions,
    required this.engine,
    required this.storage,
  });

  final SettingsController settings;
  final ModuleManager modules;
  final SubscriptionManager subscriptions;
  final VpnEngine engine;
  final StorageService storage;

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: settings),
        ChangeNotifierProvider.value(value: modules),
        ChangeNotifierProvider.value(value: subscriptions),
        ChangeNotifierProvider.value(value: AppLogger.instance),
        Provider<VpnEngine>.value(value: engine),
        Provider<StorageService>.value(value: storage),
      ],
      child: Consumer<SettingsController>(
        builder: (context, controller, _) => MaterialApp(
          title: 'NEXUS Mobile',
          debugShowCheckedModeBanner: false,
          theme: buildNexusTheme(),
          locale: controller.locale,
          supportedLocales: const [Locale('ru'), Locale('en')],
          localizationsDelegates: const [AppLocalizations.delegate],
          home: const HomeShell(),
        ),
      ),
    );
  }
}
