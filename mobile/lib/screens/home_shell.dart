import 'package:flutter/material.dart';

import '../core/l10n.dart';
import '../core/theme.dart';
import '../widgets/animated_background.dart';
import '../widgets/neu_card.dart';
import 'dashboard_screen.dart';
import 'modules_screen.dart';
import 'settings_screen.dart';
import 'subscriptions_screen.dart';

/// Каркас: живой фон + экраны с плавным переходом + компактная нижняя навигация.
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
    SubscriptionsView(),
    SettingsScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);

    final labels = [
      t.t('nav.dashboard'),
      t.t('nav.modules'),
      t.t('subs.title'),
      t.t('nav.settings'),
    ];
    final icons = [
      Icons.space_dashboard_rounded,
      Icons.widgets_rounded,
      Icons.rss_feed_rounded,
      Icons.tune_rounded,
    ];

    return Scaffold(
      body: AnimatedBackground(
        child: SafeArea(
          bottom: false,
          child: AnimatedSwitcher(
            duration: const Duration(milliseconds: 340),
            switchInCurve: Curves.easeOutCubic,
            switchOutCurve: Curves.easeInCubic,
            transitionBuilder: (child, animation) {
              return FadeTransition(
                opacity: animation,
                child: SlideTransition(
                  position: Tween<Offset>(
                    begin: const Offset(0.015, 0.02),
                    end: Offset.zero,
                  ).animate(animation),
                  child: child,
                ),
              );
            },
            child: KeyedSubtree(
              key: ValueKey(_index),
              child: _pages[_index],
            ),
          ),
        ),
      ),
      bottomNavigationBar: _BottomNav(
        index: _index,
        labels: labels,
        icons: icons,
        onTap: (i) => setState(() => _index = i),
      ),
    );
  }
}

/// Компактная плавающая навигация с маленькими кнопками.
class _BottomNav extends StatelessWidget {
  const _BottomNav({
    required this.index,
    required this.labels,
    required this.icons,
    required this.onTap,
  });

  final int index;
  final List<String> labels;
  final List<IconData> icons;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
        child: NeuCard(
          radius: 24,
          padding: const EdgeInsets.all(6),
          child: Row(
            children: List.generate(icons.length, (i) {
              final selected = i == index;
              return Expanded(
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () => onTap(i),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 240),
                    curve: Curves.easeOutCubic,
                    margin: const EdgeInsets.symmetric(horizontal: 3),
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(16),
                      gradient: selected ? AppColors.brandSoft : null,
                      border: selected
                          ? Border.all(
                              color: AppColors.primaryCyan.withOpacity(0.35),
                            )
                          : null,
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          icons[i],
                          size: 20,
                          color: selected
                              ? AppColors.primaryCyan
                              : AppColors.textMuted,
                        ),
                        const SizedBox(height: 3),
                        Text(
                          labels[i],
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 9,
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
