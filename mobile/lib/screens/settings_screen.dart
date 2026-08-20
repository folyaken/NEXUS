import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../core/constants.dart';
import '../core/l10n.dart';
import '../core/logger.dart';
import '../core/theme.dart';
import '../models/app_settings.dart';
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

    return ListView(
      padding: const EdgeInsets.fromLTRB(18, 14, 18, 24),
      children: [
        Text(
          t.t('settings.title'),
          style: const TextStyle(
            fontSize: 24,
            fontWeight: FontWeight.w800,
            color: AppColors.textPrimary,
          ),
        ).animate().fadeIn(duration: 350.ms),
        const SizedBox(height: 18),

        _section(t.t('settings.language'), [
          _segmented(
            options: const ['ru', 'en'],
            labels: const ['Русский', 'English'],
            value: s.language,
            onChanged: (v) => settings.setLanguage(v),
          ),
        ]).animate().fadeIn(duration: 400.ms, delay: 60.ms),

        _section(t.t('settings.dns'), [
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              ...AppConstants.dnsPresets.keys.map((k) => _chip(
                    label: k.toUpperCase(),
                    selected: s.dnsPreset == k,
                    onTap: () => settings.update(
                        _copy(s, dnsPreset: k)),
                  )),
              _chip(
                label: 'Custom',
                selected: s.dnsPreset == 'custom',
                onTap: () => settings.update(_copy(s, dnsPreset: 'custom')),
              ),
            ],
          ),
          if (s.dnsPreset == 'custom') ...[
            const SizedBox(height: 12),
            TextFormField(
              initialValue: s.customDns ?? '',
              onChanged: (v) =>
                  settings.update(_copy(s, customDns: v)),
              decoration: InputDecoration(
                hintText: '1.1.1.1',
                filled: true,
                fillColor: AppColors.backgroundDark,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ],
          const SizedBox(height: 8),
          Row(
            children: [
              const Icon(Icons.dns_rounded,
                  size: 15, color: AppColors.textMuted),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  '${t.t('settings.dns.hint')} · ${s.resolvedDns}',
                  style: const TextStyle(
                      fontSize: 11, color: AppColors.textMuted),
                ),
              ),
            ],
          ),
        ]).animate().fadeIn(duration: 400.ms, delay: 120.ms),

        _section('VPN', [
          _toggleRow(
            context,
            label: t.t('settings.autoConnect'),
            value: s.autoConnectVpn,
            onChanged: (v) => settings.update(_copy(s, autoConnectVpn: v)),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: Text(t.t('settings.subsInterval'),
                    style:
                        const TextStyle(color: AppColors.textPrimary)),
              ),
              Text(
                '${s.subscriptionRefreshHours} ${t.t('common.hours')}',
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: AppColors.primaryCyan,
                ),
              ),
            ],
          ),
          Slider(
            value: s.subscriptionRefreshHours.toDouble(),
            min: 1,
            max: 24,
            divisions: 23,
            activeColor: AppColors.primaryCyan,
            onChanged: (v) {
              settings.update(_copy(s, subscriptionRefreshHours: v.round()));
              context
                  .read<SubscriptionManager>()
                  .configureAutoRefresh(v.round());
            },
          ),
        ]).animate().fadeIn(duration: 400.ms, delay: 180.ms),

        _section('JSON', [
          _tile(
            icon: Icons.upload_rounded,
            color: AppColors.primaryCyan,
            title: t.t('settings.export'),
            onTap: () => _export(context),
          ),
          _tile(
            icon: Icons.download_rounded,
            color: AppColors.primaryPurple,
            title: t.t('settings.import'),
            onTap: () => _import(context),
          ),
          _tile(
            icon: Icons.article_rounded,
            color: AppColors.textSecondary,
            title: t.t('settings.logs'),
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const LogsScreen()),
            ),
          ),
        ]).animate().fadeIn(duration: 400.ms, delay: 240.ms),

        const SizedBox(height: 10),

        SizedBox(
          height: 52,
          child: DecoratedBox(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              gradient: LinearGradient(
                colors: [
                  AppColors.red.withOpacity(0.25),
                  AppColors.red.withOpacity(0.7),
                ],
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
        ).animate().fadeIn(duration: 400.ms, delay: 300.ms),

        const SizedBox(height: 14),
        Center(
          child: Text(
            '${t.t('settings.about')} · NEXUS Mobile ${AppConstants.appVersion}',
            style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
          ),
        ),
      ],
    );
  }

  Widget _section(String title, List<Widget> children) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: NeuCard(
        radius: 20,
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
            const SizedBox(height: 14),
            ...children,
          ],
        ),
      ),
    );
  }

  Widget _tile({
    required IconData icon,
    required Color color,
    required String title,
    required VoidCallback onTap,
  }) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Container(
        width: 36,
        height: 36,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(11),
          color: color.withOpacity(0.12),
        ),
        child: Icon(icon, color: color, size: 19),
      ),
      title: Text(title,
          style: const TextStyle(
              fontSize: 14, color: AppColors.textPrimary)),
      trailing:
          const Icon(Icons.chevron_right_rounded, color: AppColors.textMuted),
      onTap: onTap,
    );
  }

  Widget _chip({
    required String label,
    required bool selected,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          gradient: selected ? AppColors.brandGradient : null,
          color: selected ? null : AppColors.cardLight,
        ),
        child: Text(
          label,
          style: TextStyle(
            fontWeight: FontWeight.w700,
            fontSize: 12,
            color: selected ? AppColors.backgroundDark : AppColors.textSecondary,
          ),
        ),
      ),
    );
  }

  Widget _toggleRow(
    BuildContext context, {
    required String label,
    required bool value,
    required ValueChanged<bool> onChanged,
  }) {
    return Row(
      children: [
        Expanded(
          child: Text(label,
              style: const TextStyle(
                  fontSize: 14, color: AppColors.textPrimary)),
        ),
        NeonToggle(value: value, onChanged: onChanged),
      ],
    );
  }

  Widget _segmented({
    required List<String> options,
    required List<String> labels,
    required String value,
    required ValueChanged<String> onChanged,
  }) {
    return Row(
      children: List.generate(options.length, (i) {
        final active = options[i] == value;
        return Expanded(
          child: GestureDetector(
            onTap: () => onChanged(options[i]),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              margin: EdgeInsets.only(right: i == options.length - 1 ? 0 : 8),
              padding: const EdgeInsets.symmetric(vertical: 11),
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
                  color: active
                      ? AppColors.backgroundDark
                      : AppColors.textSecondary,
                ),
              ),
            ),
          ),
        );
      }),
    );
  }

  Future<void> _export(BuildContext context) async {
    final manager = context.read<SubscriptionManager>();
    await Share.share(manager.exportJson(), subject: 'NEXUS subscriptions');
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

  AppSettings _copy(
    AppSettings s, {
    String? dnsPreset,
    String? customDns,
    bool? autoConnectVpn,
    int? subscriptionRefreshHours,
  }) {
    return AppSettings.fromJson({
      ...s.toJson(),
      if (dnsPreset != null) 'dnsPreset': dnsPreset,
      if (customDns != null) 'customDns': customDns,
      if (autoConnectVpn != null) 'autoConnectVpn': autoConnectVpn,
      if (subscriptionRefreshHours != null)
        'subscriptionRefreshHours': subscriptionRefreshHours,
    });
  }
}
