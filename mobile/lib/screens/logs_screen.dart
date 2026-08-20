import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/l10n.dart';
import '../core/logger.dart';
import '../core/theme.dart';

/// Журнал событий приложения.
class LogsScreen extends StatelessWidget {
  const LogsScreen({super.key});

  Color _colorFor(String level) => switch (level) {
        'success' => AppColors.mint,
        'warn' => AppColors.amber,
        'error' => AppColors.red,
        _ => AppColors.textSecondary,
      };

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final logger = context.watch<AppLogger>();

    return Scaffold(
      appBar: AppBar(
        title: Text(t.t('logs.title')),
        actions: [
          IconButton(
            onPressed: logger.clear,
            icon: const Icon(Icons.delete_sweep_outlined),
          ),
        ],
      ),
      body: logger.entries.isEmpty
          ? Center(
              child: Text(
                t.t('logs.empty'),
                style: const TextStyle(color: AppColors.textSecondary),
              ),
            )
          : ListView.builder(
              padding: const EdgeInsets.all(14),
              itemCount: logger.entries.length,
              itemBuilder: (context, i) {
                final e = logger.entries[i];
                final time =
                    '${e.time.hour.toString().padLeft(2, '0')}:${e.time.minute.toString().padLeft(2, '0')}:${e.time.second.toString().padLeft(2, '0')}';
                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: 5),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        time,
                        style: const TextStyle(
                          fontSize: 10,
                          color: AppColors.textMuted,
                          fontFamily: 'monospace',
                        ),
                      ),
                      const SizedBox(width: 10),
                      Container(
                        width: 6,
                        height: 6,
                        margin: const EdgeInsets.only(top: 5),
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: _colorFor(e.level),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          '[${e.source}] ${e.message}',
                          style: TextStyle(
                            fontSize: 12,
                            color: _colorFor(e.level),
                          ),
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
    );
  }
}
