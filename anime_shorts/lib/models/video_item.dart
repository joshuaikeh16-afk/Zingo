class VideoItem {
  final String id;
  final String videoUrl;
  final String thumbnailUrl;
  final String uploaderUsername;
  final String uploaderAvatarUrl;
  final String caption;
  final List<String> hashtags;
  final String audioTrackName;
  final int likeCount;
  final int commentCount;
  final int shareCount;
  final bool isLiked;
  final bool isBookmarked;

  VideoItem({
    required this.id,
    required this.videoUrl,
    required this.thumbnailUrl,
    required this.uploaderUsername,
    required this.uploaderAvatarUrl,
    required this.caption,
    required this.hashtags,
    required this.audioTrackName,
    required this.likeCount,
    required this.commentCount,
    required this.shareCount,
    this.isLiked = false,
    this.isBookmarked = false,
  });

  VideoItem copyWith({
    String? id,
    String? videoUrl,
    String? thumbnailUrl,
    String? uploaderUsername,
    String? uploaderAvatarUrl,
    String? caption,
    List<String>? hashtags,
    String? audioTrackName,
    int? likeCount,
    int? commentCount,
    int? shareCount,
    bool? isLiked,
    bool? isBookmarked,
  }) {
    return VideoItem(
      id: id ?? this.id,
      videoUrl: videoUrl ?? this.videoUrl,
      thumbnailUrl: thumbnailUrl ?? this.thumbnailUrl,
      uploaderUsername: uploaderUsername ?? this.uploaderUsername,
      uploaderAvatarUrl: uploaderAvatarUrl ?? this.uploaderAvatarUrl,
      caption: caption ?? this.caption,
      hashtags: hashtags ?? this.hashtags,
      audioTrackName: audioTrackName ?? this.audioTrackName,
      likeCount: likeCount ?? this.likeCount,
      commentCount: commentCount ?? this.commentCount,
      shareCount: shareCount ?? this.shareCount,
      isLiked: isLiked ?? this.isLiked,
      isBookmarked: isBookmarked ?? this.isBookmarked,
    );
  }
}
