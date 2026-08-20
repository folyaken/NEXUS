import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:provider/provider.dart';

import '../core/l10n.dart';
import '../core/theme.dart';
import '../models/app_settings.dart';
import '../models/module_info.dart';
import '../services/module_manager.dart';
import '../state/settings_controller.dart';
import '../widgets/module_card.dart';
import '../widgets/neu_card.dart';

/// Экран «Модули»: карточки модулей + сайты для обхода DPI.
class ModulesScreen extends StatelessWidget {
  const ModulesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final modules = context.watch<ModuleManager>();
    final settings = context.watch<SettingsController>();

    return ListView(
      padding: const EdgeInsets.fromLTRB(18, 14, 18, 24),
      children: [
        _header(context, t, modules)
            .animate()
            .fadeIn(duration: 350.ms)
            .slideY(begin: -0.04, end: 0),
        const SizedBox(height: 18),
        ...List.generate(modules.modules.length, (i) {
          final m = modules.modules[i];
          return Padding(
            padding: const EdgeInsets.only(bottom: 14),
            child: ModuleCard(
              module: m,
              name: t.t(m.nameKey),
              description: t.t(m.descKey),
              statusLabel: t.t(_statusKey(m)),
              actionLabel:
                  m.isRunning ? t.t('modules.stop') : t.t('modules.start'),
              onToggle: () => modules.toggle(m.id),
            ),
          ).animate().fadeIn(
                duration: 400.ms,
                delay: Duration(milliseconds: 100 + i * 70),
              ).slideY(begin: 0.06, end: 0);
        }),
        const SizedBox(height: 8),
        _dpiSection(context, t, settings)
            .animate()
            .fadeIn(duration: 400.ms, delay: 400.ms),
      ],
    );
  }

  Widget _header(BuildContext context, AppLocalizations t, ModuleManager modules) {
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                t.t('modules.title'),
                style: const TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                '${modules.runningCount}/${modules.totalCount} ${t.t('dashboard.running')}',
                style: const TextStyle(
                  fontSize: 12,
                  color: AppColors.textSecondary,
                ),
              ),
            ],
          ),
        ),
        NeuCard(
          radius: 999,
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          child: Text(
            '${modules.runningCount}/${modules.totalCount}',
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w800,
              color: AppColors.primaryCyan,
              fontFamily: 'monospace',
            ),
          ),
        ),
      ],
    );
  }

  Widget _dpiSection(
      BuildContext context, AppLocalizations t, SettingsController settings) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          t.t('modules.dpi.sites'),
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w700,
            color: AppColors.textPrimary,
          ),
        ),
        const SizedBox(height: 12),
        NeuCard(
          radius: 18,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children:
                    settings.settings.dpiSites.map((site) => _siteChip(
                          site: site,
                          onDelete: () {
                            final next =
                                List<String>.from(settings.settings.dpiSites)
                                  ..remove(site);
                            settings.update(
                                _copySettings(next, settings.settings));
                          },
                        )).toList(),
              ),
              const SizedBox(height: 12),
              TextButton.icon(
                onPressed: () => _addSite(context, settings),
                icon: const Icon(Icons.add, size: 18),
                label: Text(t.t('modules.dpi.add')),
                style: TextButton.styleFrom(
                  foregroundColor: AppColors.primaryCyan,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _siteChip({required String site, required VoidCallback onDelete}) {
    return InputChip(
      label: Text(site),
      labelStyle: const TextStyle(
        fontSize: 12,
        color: AppColors.textPrimary,
      ),
      backgroundColor: AppColors.cardLight,
      side: const BorderSide(color: Colors.white12),
      deleteIconColor: AppColors.textMuted,
      onDeleted: onDelete,
    );
  }

  void _addSite(BuildContext context, SettingsController settings) {
    final controller = TextEditingController();
    final t = AppLocalizations.of(context);
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.cardDark,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: Text(t.t('modules.dpi.add')),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: InputDecoration(
            hintText: t.t('modules.dpi.hint'),
            filled: true,
            fillColor: AppColors.backgroundDark,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide.none,
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text(t.t('common.cancel')),
          ),
          TextButton(
            onPressed: () {
              final value = controller.text.trim().toLowerCase();
              if (value.isNotEmpty) {
                final next = List<String>.from(settings.settings.dpiSites)
                  ..add(value);
                settings.update(_copySettings(next, settings.settings));
              }
              Navigator.pop(ctx);
            },
            child: Text(t.t('common.add')),
          ),
        ],
      ),
    );
  }

  String _statusKey(ModuleInfo m) {
    switch (m.status) {
      case ModuleStatus.running:
      case ModuleStatus.starting:
        return 'modules.status.running';
      case ModuleStatus.error:
        return 'modules.status.error';
      default:
        return 'modules.status.stopped';
    }
  }

  AppSettings _copySettings(List<String> dpiSites, AppSettings s) {
    return AppSettings.fromJson({...s.toJson(), 'dpiSites': dpiSites});
  }
}
