/// Запись журнала.
class LogEntry {
  LogEntry({
    required this.time,
    required this.level,
    required this.source,
    required this.message,
  });

  final DateTime time;
  final String level; // info | success | warn | error
  final String source;
  final String message;

  Map<String, dynamic> toJson() => {
        'time': time.toIso8601String(),
        'level': level,
        'source': source,
        'message': message,
      };

  factory LogEntry.fromJson(Map<String, dynamic> json) => LogEntry(
        time: DateTime.tryParse(json['time'] as String? ?? '') ??
            DateTime.now(),
        level: json['level'] as String? ?? 'info',
        source: json['source'] as String? ?? 'nexus',
        message: json['message'] as String? ?? '',
      );
}
