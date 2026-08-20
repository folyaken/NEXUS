import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../core/constants.dart';
import '../core/l10n.dart';
import '../core/logger.dart';
import '../models/app_settings.dart';
import '../core/theme.dart';
import '../services/module_manager.dart';
import '../services/subscription_manager.dart';
import '../state/settings_controller.dart';
import '../widgets/neu_card.dart';
import '../widgets/neon_toggle.dart';
import 'logs_screen.dart';

/// Настройки приложения.
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final settings = context.watch<SettingsController>();
    final s = settings.settings;

    return SafeArea(
      child: ListView(
        padding: const EdgeInsets.fromLTRB(18, 18, 18, 24),
        children: [
          Text(
            t.t('settings.title'),
            style: const TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 18),

          // Язык
          _section(t.t('settings.language'), [
            _segmented<String>(
              options: const ['ru', 'en'],
              labels: const ['Русский', 'English'],
              value: s.language,
              onChanged: (v) => settings.setLanguage(v),
            ),
          ]),

          // DNS
          _section(t.t('settings.dns'), [
            DropdownButtonFormField<String>(
              value: s.dnsPreset,
              dropdownColor: AppColors.cardDark,
              style: const TextStyle(color: AppColors.textPrimary, fontSize: 13),
              decoration: InputDecoration(
                filled: true,
                fillColor: AppColors.backgroundDark,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide.none,
                ),
              ),
              items: [
                ...AppConstants.dnsPresets.keys.map(
                  (k) => DropdownMenuItem(value: k, child: Text(k.toUpperCase())),
                ),
                const DropdownMenuItem(value: 'custom', child: Text('Custom')),
              ],
              onChanged: (v) {
                if (v != null) {
                  settings.update(AppSettings_copy(settings.settings, dnsPreset: v));
                }
              },
            ),
            if (s.dnsPreset == 'custom') ...[
              const SizedBox(height: 10),
              _textField(
                hint: '1.1.1.1',
                value: s.customDns ?? '',
                onChanged: (v) {
                  settings.update(AppSettings_copy(settings.settings, customDns: v));
                },
              ),
            ],
            Text(
              t.t('settings.dns.hint'),
              style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
            ),
          ]),

          // Поведение
          _section('VPN', [
            _toggleRow(
              context,
              label: t.t('settings.autoConnect'),
              value: s.autoConnectVpn,
              onChanged: (v) {
                settings.update(AppSettings_copy(settings.settings, autoConnectVpn: v));
              },
            ),
            _toggleRow(
              context,
              label: t.t('settings.subsInterval'),
              value: false,
              onChanged: (_) {},
              custom: Slider(
                value: s.subscriptionRefreshHours.toDouble(),
                min: 1,
                max: 24,
                divisions: 23,
                activeColor: AppColors.primaryCyan,
                label: '${s.subscriptionRefreshHours} ${t.t('common.hours')}',
                onChanged: (v) {
                  settings.update(AppSettings_copy(
                    settings.settings,
                    subscriptionRefreshHours: v.round(),
                  ));
                  context
                      .read<SubscriptionManager>()
                      .configureAutoRefresh(v.round());
                },
              ),
            ),
          ]),

          // Обмен данными
          _section('JSON', [
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.upload, color: AppColors.primaryCyan),
              title: Text(t.t('settings.export')),
              onTap: () => _export(context),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.download, color: AppColors.primaryPurple),
              title: Text(t.t('settings.import')),
              onTap: () => _import(context),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.article, color: AppColors.textSecondary),
              title: Text(t.t('settings.logs')),
              onTap: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const LogsScreen()),
              ),
            ),
          ]),

          const SizedBox(height: 10),

          // Отключить всё
          SizedBox(
            height: 52,
            child: DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(16),
                gradient: LinearGradient(
                  colors: [AppColors.red.withOpacity(alpha: 0.25), AppColors.red],
                ),
              ),
              child: TextButton(
                onPressed: () => context.read<ModuleManager>().stopAll(),
                child: const Text(
                  'Отключить всё',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                    fontSize: 15,
                  ),
                ),
              ),
            ),
          ),

          const SizedBox(height: 14),
          Center(
            child: Text(
              '${t.t('settings.about')} · NEXUS Mobile ${AppConstants.appVersion}',
              style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
            ),
          ),
        ],
      ),
    );
  }

  Widget _section(String title, List<Widget> children) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: NeuCard(
        radius: 18,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title.toUpperCase(),
              style: const TextStyle(
                fontSize: 11,
                letterSpacing: 1.4,
                fontWeight: FontWeight.w700,
                color: AppColors.textMuted,
              ),
            ),
            const SizedBox(height: 12),
            ...children,
          ],
        ),
      ),
    );
  }

  Widget _toggleRow(
    BuildContext context, {
    required String label,
    required bool value,
    required ValueChanged<bool> onChanged,
    Widget? custom,
  }) {
    return Row(
      children: [
        Expanded(child: Text(label, style: const TextStyle(color: AppColors.textPrimary))),
        if (custom != null)
          SizedBox(width: 200, child: custom)
        else
          NeonToggle(value: value, onChanged: onChanged),
      ],
    );
  }

  Widget _segmented<T>({
    required List<T> options,
    required List<String> labels,
    required T value,
    required ValueChanged<T> onChanged,
  }) {
    return Row(
      children: List.generate(options.length, (i) {
        final active = options[i] == value;
        return Expanded(
          child: GestureDetector(
            onTap: () => onChanged(options[i]),
            child: Container(
              margin: EdgeInsets.only(right: i == options.length - 1 ? 0 : 8),
              padding: const EdgeInsets.symmetric(vertical: 10),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(12),
                gradient: active ? AppColors.brandGradient : null,
                color: active ? null : AppColors.cardLight,
              ),
              alignment: Alignment.center,
              child: Text(
                labels[i],
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 13,
                  color: active ? const Color(0xFF0A0E1A) : AppColors.textSecondary,
                ),
              ),
            ),
          ),
        );
      }),
    );
  }

  Widget _textField({
    required String hint,
    required String value,
    required ValueChanged<String> onChanged,
  }) {
    return TextFormField(
      initialValue: value,
      onChanged: onChanged,
      decoration: InputDecoration(
        hintText: hint,
        filled: true,
        fillColor: AppColors.backgroundDark,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide.none,
        ),
      ),
    );
  }

  Future<void> _export(BuildContext context) async {
    final manager = context.read<SubscriptionManager>();
    final json = manager.exportJson();
    await Share.share(json, subject: 'NEXUS subscriptions');
    AppLogger.instance.info('export', 'Подписки экспортированы');
  }

  Future<void> _import(BuildContext context) async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['json'],
    );
    final path = result?.files.single.path;
    if (path == null) return;
    final raw = await File(path).readAsString();
    final count = await context.read<SubscriptionManager>().importJson(raw);
    AppLogger.instance.success('import', 'Импортировано профилей: $count');
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Импортировано профилей: $count')),
      );
    }
  }
}

/// Утилита-копия настроек с изменёнными полями.
AppSettings AppSettings_copy(
  AppSettings s, {
  String? dnsPreset,
  String? customDns,
  bool? autoConnectVpn,
  int? subscriptionRefreshHours,
  String? language,
}) {
  return AppSettings.fromJson({
    ...s.toJson(),
    if (dnsPreset != null) 'dnsPreset': dnsPreset,
    if (customDns != null) 'customDns': customDns,
    if (autoConnectVpn != null) 'autoConnectVpn': autoConnectVpn,
    if (subscriptionRefreshHours != null)
      'subscriptionRefreshHours': subscriptionRefreshHours,
    if (language != null) 'language': language,
  });
}
