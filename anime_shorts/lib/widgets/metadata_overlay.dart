import 'package:flutter/material.dart';
import '../models/video_item.dart';

class MetadataOverlay extends StatelessWidget {
  final VideoItem videoItem;

  const MetadataOverlay({super.key, required this.videoItem});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Profile Info
        Row(
          children: [
            CircleAvatar(
              radius: 20,
              backgroundColor: Colors.cyan.withOpacity(0.3),
              backgroundImage: NetworkImage(videoItem.uploaderAvatarUrl),
              onBackgroundImageError: (_, __) {},
              child: ClipOval(
                child: Image.network(
                  videoItem.uploaderAvatarUrl,
                  fit: BoxFit.cover,
                  errorBuilder: (context, error, stackTrace) => Icon(
                    Icons.person,
                    color: Colors.cyan,
                    size: 24,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Text(
              '@${videoItem.uploaderUsername}',
              style: const TextStyle(
                color: Colors.white,
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(width: 8),
            ElevatedButton(
              onPressed: () {},
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.cyan,
                foregroundColor: Colors.black,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(20),
                ),
              ),
              child: const Text(
                'Follow',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        
        // Caption
        RichText(
          text: TextSpan(
            style: const TextStyle(
              color: Colors.white,
              fontSize: 15,
              height: 1.4,
            ),
            children: [
              TextSpan(text: videoItem.caption.split('#')[0]),
              ..._buildHashtags(videoItem.hashtags),
            ],
          ),
        ),
        const SizedBox(height: 12),
        
        // Audio Track
        _buildAudioTrack(),
      ],
    );
  }

  List<TextSpan> _buildHashtags(List<String> hashtags) {
    List<TextSpan> spans = [];
    for (var hashtag in hashtags) {
      spans.add(
        TextSpan(
          text: '#$hashtag ',
          style: const TextStyle(
            color: Colors.cyan,
            fontWeight: FontWeight.w600,
          ),
        ),
      );
    }
    return spans;
  }

  Widget _buildAudioTrack() {
    return Row(
      children: [
        const Icon(
          Icons.music_note,
          color: Colors.cyan,
          size: 18,
        ),
        const SizedBox(width: 8),
        Expanded(
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Text(
              videoItem.audioTrackName,
              style: const TextStyle(
                color: Colors.white70,
                fontSize: 14,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ),
      ],
    );
  }
}
