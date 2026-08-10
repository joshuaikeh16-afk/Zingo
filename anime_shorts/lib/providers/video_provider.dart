import 'package:flutter/foundation.dart';
import 'package:video_player/video_player.dart';
import '../models/video_item.dart';

class VideoPlayerState {
  final Map<String, VideoPlayerController> controllers;
  final String? currentVideoId;
  final bool isPlaying;
  final List<VideoItem> videoFeed;
  final int currentIndex;
  final bool isLoading;

  VideoPlayerState({
    required this.controllers,
    this.currentVideoId,
    this.isPlaying = false,
    required this.videoFeed,
    this.currentIndex = 0,
    this.isLoading = false,
  });

  VideoPlayerState copyWith({
    Map<String, VideoPlayerController>? controllers,
    String? currentVideoId,
    bool? isPlaying,
    List<VideoItem>? videoFeed,
    int? currentIndex,
    bool? isLoading,
  }) {
    return VideoPlayerState(
      controllers: controllers ?? this.controllers,
      currentVideoId: currentVideoId ?? this.currentVideoId,
      isPlaying: isPlaying ?? this.isPlaying,
      videoFeed: videoFeed ?? this.videoFeed,
      currentIndex: currentIndex ?? this.currentIndex,
      isLoading: isLoading ?? this.isLoading,
    );
  }
}

class VideoProvider extends ChangeNotifier {
  VideoPlayerState _state = VideoPlayerState(controllers: {}, videoFeed: []);

  VideoPlayerState get state => _state;

  List<VideoItem> get videoFeed => _state.videoFeed;
  int get currentIndex => _state.currentIndex;
  bool get isPlaying => _state.isPlaying;
  String? get currentVideoId => _state.currentVideoId;

  // Sample data for demonstration
  void initializeFeed() {
    _state = _state.copyWith(
      videoFeed: [
        VideoItem(
          id: '1',
          videoUrl: 'https://assets.mixkit.co/videos/preview/mixkit-anime-girl-looking-at-the-sky-42956-large.mp4',
          thumbnailUrl: 'https://via.placeholder.com/400x800/1a1a2e/eee?text=Anime+1',
          uploaderUsername: 'anime_edits_pro',
          uploaderAvatarUrl: 'https://via.placeholder.com/100/1a1a2e/eee?text=AE',
          caption: 'Epic Gear 5 moment! 🔥 #OnePiece #Gear5 #Luffy #AnimeEdit',
          hashtags: ['OnePiece', 'Gear5', 'Luffy', 'AnimeEdit'],
          audioTrackName: 'We Are! (One Piece OP)',
          likeCount: 12500,
          commentCount: 342,
          shareCount: 891,
        ),
        VideoItem(
          id: '2',
          videoUrl: 'https://assets.mixkit.co/videos/preview/mixkit-anime-style-forest-scene-42958-large.mp4',
          thumbnailUrl: 'https://via.placeholder.com/400x800/16213e/eee?text=Anime+2',
          uploaderUsername: 'otaku_clips',
          uploaderAvatarUrl: 'https://via.placeholder.com/100/16213e/eee?text=OC',
          caption: 'Beautiful forest vibes 🌲✨ #Naruto #Shippuden #AnimeScenery',
          hashtags: ['Naruto', 'Shippuden', 'AnimeScenery'],
          audioTrackName: 'Sadness and Sorrow',
          likeCount: 8900,
          commentCount: 156,
          shareCount: 423,
        ),
        VideoItem(
          id: '3',
          videoUrl: 'https://assets.mixkit.co/videos/preview/mixkit-anime-girl-with-headphones-42957-large.mp4',
          thumbnailUrl: 'https://via.placeholder.com/400x800/0f3460/eee?text=Anime+3',
          uploaderUsername: 'amv_master',
          uploaderAvatarUrl: 'https://via.placeholder.com/100/0f3460/eee?text=AM',
          caption: 'When the beat drops 🎵💜 #AMV #Edit #AnimeMusicVideo',
          hashtags: ['AMV', 'Edit', 'AnimeMusicVideo'],
          audioTrackName: 'Unravel (Tokyo Ghoul OP)',
          likeCount: 15200,
          commentCount: 489,
          shareCount: 1205,
        ),
      ],
    );
    notifyListeners();
  }

  Future<void> initializeController(String videoId, String videoUrl) async {
    if (_state.controllers.containsKey(videoId)) {
      return;
    }

    try {
      final controller = VideoPlayerController.networkUrl(Uri.parse(videoUrl));
      await controller.initialize();
      controller.setLooping(true);
      controller.setVolume(1.0);

      _state = _state.copyWith(
        controllers: {..._state.controllers, videoId: controller},
      );
      notifyListeners();

      // Pre-load next video
      _preloadNextVideo();
    } catch (e) {
      print('Error initializing video controller: $e');
    }
  }

  void _preloadNextVideo() {
    final nextIndex = _state.currentIndex + 1;
    if (nextIndex < _state.videoFeed.length) {
      final nextVideo = _state.videoFeed[nextIndex];
      initializeController(nextVideo.id, nextVideo.videoUrl);
    }
  }

  void playVideo(String videoId) {
    final controller = _state.controllers[videoId];
    if (controller != null && controller.value.isInitialized) {
      controller.play();
      _state = _state.copyWith(
        currentVideoId: videoId,
        isPlaying: true,
      );
      notifyListeners();
    }
  }

  void pauseVideo(String videoId) {
    final controller = _state.controllers[videoId];
    if (controller != null && controller.value.isInitialized) {
      controller.pause();
      _state = _state.copyWith(isPlaying: false);
      notifyListeners();
    }
  }

  void togglePlayPause(String videoId) {
    if (_state.isPlaying) {
      pauseVideo(videoId);
    } else {
      playVideo(videoId);
    }
  }

  void setCurrentIndex(int index) {
    if (index >= 0 && index < _state.videoFeed.length) {
      // Pause previous video
      if (_state.currentVideoId != null) {
        pauseVideo(_state.currentVideoId!);
      }

      _state = _state.copyWith(currentIndex: index);
      notifyListeners();

      // Play new video
      final newVideo = _state.videoFeed[index];
      initializeController(newVideo.id, newVideo.videoUrl).then((_) {
        playVideo(newVideo.id);
      });
    }
  }

  void toggleLike(String videoId) {
    final index = _state.videoFeed.indexWhere((v) => v.id == videoId);
    if (index != -1) {
      final video = _state.videoFeed[index];
      final updatedVideo = video.copyWith(
        isLiked: !video.isLiked,
        likeCount: video.isLiked ? video.likeCount - 1 : video.likeCount + 1,
      );

      _state = _state.copyWith(
        videoFeed: [
          ..._state.videoFeed.sublist(0, index),
          updatedVideo,
          ..._state.videoFeed.sublist(index + 1),
        ],
      );
      notifyListeners();
    }
  }

  void toggleBookmark(String videoId) {
    final index = _state.videoFeed.indexWhere((v) => v.id == videoId);
    if (index != -1) {
      final video = _state.videoFeed[index];
      final updatedVideo = video.copyWith(isBookmarked: !video.isBookmarked);

      _state = _state.copyWith(
        videoFeed: [
          ..._state.videoFeed.sublist(0, index),
          updatedVideo,
          ..._state.videoFeed.sublist(index + 1),
        ],
      );
      notifyListeners();
    }
  }

  @override
  void dispose() {
    for (final controller in _state.controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }
}
