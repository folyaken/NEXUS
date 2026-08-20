import 'package:flutter/material.dart';

import '../core/l10n.dart';
import '../core/theme.dart';
import 'dashboard_screen.dart';
import 'jey2ray_screen.dart';
import 'modules_screen.dart';
import 'settings_screen.dart';

/// Каркас с нижней неоморфной навигацией.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  static const _pages = [
    DashboardScreen(),
    ModulesScreen(),
    Jey2RayScreen(),
    SettingsScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final labels = [
      t.t('nav.dashboard'),
      t.t('nav.modules'),
      t.t('nav.vpn'),
      t.t('nav.settings'),
    ];
    final icons = [
      Icons.dashboard_rounded,
      Icons.widgets_rounded,
      Icons.public_rounded,
      Icons.settings_rounded,
    ];

    return Scaffold(
      body: IndexedStack(index: _index, children: _pages),
      bottomNavigationBar: SafeArea(
        child: Container(
          margin: const EdgeInsets.fromLTRB(14, 0, 14, 12),
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
          decoration: Neu.card(radius: 26, depth: 8),
          child: Row(
            children: List.generate(4, (i) {
              final selected = i == _index;
              return Expanded(
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () => setState(() => _index = i),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    padding: const EdgeInsets.symmetric(vertical: 10),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(18),
                      gradient: selected
                          ? const LinearGradient(
                              colors: [
                                Color(0x2900D4AA), // cyan ~16%
                                Color(0x296C63FF), // violet ~16%
                              ],
                            )
                          : null,
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          icons[i],
                          size: 24,
                          color: selected
                              ? AppColors.primaryCyan
                              : AppColors.textMuted,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          labels[i],
                          style: TextStyle(
                            fontSize: 10,
                            fontWeight: selected
                                ? FontWeight.w700
                                : FontWeight.w500,
                            color: selected
                                ? AppColors.primaryCyan
                                : AppColors.textMuted,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              );
            }),
          ),
        ),
      ),
    );
  }
}
