import 'package:flutter/material.dart';

import 'app.dart';
import 'core/logger.dart';
import 'services/module_manager.dart';
import 'services/storage_service.dart';
import 'services/subscription_manager.dart';
import 'services/vpn_engine.dart';
import 'state/settings_controller.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final storage = StorageService();
  await storage.init();

  final settings = SettingsController(storage);
  await settings.load();

  final engine = VpnEngineFactory.create();
  final modules = ModuleManager(engine);
  final subscriptions = SubscriptionManager(storage, engine);
  await subscriptions.load();
  subscriptions.configureAutoRefresh(settings.settings.subscriptionRefreshHours);

  await AppLogger.instance.load();

  runApp(NexusApp(
    settings: settings,
    modules: modules,
    subscriptions: subscriptions,
    engine: engine,
    storage: storage,
  ));
}
