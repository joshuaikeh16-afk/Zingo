# 🎬 Anime Shorts - Vertical Anime Video Platform

A modern, immersive vertical short-video streaming mobile application tailored specifically for anime clips, edits, and AMVs (Anime Music Videos), inspired by TikTok's core UX.

## 🌟 Features

### Main Feed (Vertical Player)
- **Fullscreen PageView/Snap Scroll**: Vertical scrolling with smooth snap-to-next behavior
- **Auto-play/Pause**: Active video plays automatically, off-screen videos pause to save resources
- **Seamless Looping**: Continuous playback for each video
- **Tap Controls**: Tap to toggle play/pause with animated overlay
- **Pre-loading**: Next video buffers in advance to eliminate lag during swipes

### Content Metadata Overlay (Bottom Left)
- Uploader profile picture and username
- Caption with clickable hashtags (#OnePiece, #Gear5, #Edit, etc.)
- Audio Track Tag with spinning disc animation showing background track/anime OP name

### Engagement Sidebar (Bottom Right)
- **Like Button**: Heart icon with counter animation, fills red on tap
- **Comments Button**: Opens bottom sheet with threaded user comments
- **Bookmark/Save Button**: Adds clip to offline watch/download queue
- **Share Button**: Native share sheet trigger

### Bottom Navigation Bar
Clean, translucent bottom bar with 4 main tabs:
1. **Home** - Main vertical feed with "Following" and "For You" toggle
2. **Discover** - Explore trending anime hashtags, characters, and audio tracks
3. **Create** - Interface to select local video clips, trim, and add metadata
4. **Profile** - User dashboard showing uploaded clips, liked videos, and downloads

## 🎨 UI Design

- **Theme**: Modern, immersive dark theme optimized for AMOLED screens
- **Colors**: Pure blacks (#000000), translucent overlays, neon accent colors (Cyan #00BCD4, Violet #9C27B0)
- **Responsive Scaling**: Media scales correctly (BoxFit.cover) across all smartphone aspect ratios

## 🏗️ Architecture

### Tech Stack
- **Framework**: Flutter (Dart)
- **State Management**: Provider pattern
- **Video Player**: video_player package
- **Image Caching**: cached_network_image

### Project Structure
```
lib/
├── main.dart                 # App entry point & navigation
├── models/
│   └── video_item.dart       # Video data model
├── providers/
│   └── video_provider.dart   # State management for videos
├── screens/
│   ├── home_screen.dart      # Main feed with PageView
│   ├── discover_screen.dart  # Search & explore
│   ├── upload_screen.dart    # Create/upload interface
│   └── profile_screen.dart   # User profile
└── widgets/
    ├── video_player_widget.dart   # Video player component
    ├── engagement_sidebar.dart    # Like, comment, share buttons
    └── metadata_overlay.dart      # Caption, hashtags, audio info
```

## 🚀 Getting Started

### Prerequisites
- Flutter SDK (>=3.0.0 <4.0.0)
- Dart SDK
- Android Studio / VS Code with Flutter extensions
- iOS (Xcode) or Android device/emulator

### Installation

1. Clone the repository:
```bash
cd anime_shorts
```

2. Install dependencies:
```bash
flutter pub get
```

3. Run the app:
```bash
flutter run
```

## 📱 Usage

### Home Screen
- Swipe up/down to navigate between videos
- Tap screen to play/pause video
- Double-tap to like (future enhancement)
- Toggle between "Following" and "For You" feeds at the top

### Discover Screen
- Search for anime, hashtags, and audio tracks
- Browse trending hashtags and audio
- Tap to explore content by category

### Create Screen
- Upload video clips from device
- Add captions and hashtags
- Select background audio from anime OP/ED library
- Preview before publishing

### Profile Screen
- View your uploaded videos grid
- Check followers, following, and likes stats
- Access liked and bookmarked videos tabs

## 🔧 Configuration

### Adding Custom Video Sources
Edit `lib/providers/video_provider.dart` in the `initializeFeed()` method:

```dart
VideoItem(
  id: 'unique_id',
  videoUrl: 'https://your-cdn.com/video.mp4',
  thumbnailUrl: 'https://your-cdn.com/thumbnail.jpg',
  uploaderUsername: 'username',
  uploaderAvatarUrl: 'https://your-cdn.com/avatar.jpg',
  caption: 'Your caption here',
  hashtags: ['Tag1', 'Tag2'],
  audioTrackName: 'Audio Track Name',
  likeCount: 0,
  commentCount: 0,
  shareCount: 0,
),
```

## 🎯 Performance Optimizations

1. **Video Pre-loading**: Next video in queue loads while current plays
2. **Controller Management**: Video controllers are disposed properly to prevent memory leaks
3. **State Preservation**: Scroll position and playback state maintained when switching tabs
4. **Efficient Rendering**: Only active video renders at full quality

## 📄 License

This project is open source and available under the MIT License.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

**Built with ❤️ for anime fans worldwide**
