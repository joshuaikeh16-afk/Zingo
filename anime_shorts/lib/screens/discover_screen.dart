import 'package:flutter/material.dart';

class DiscoverScreen extends StatelessWidget {
  const DiscoverScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final trendingHashtags = [
      '#OnePiece', '#Naruto', '#DemonSlayer', '#AttackOnTitan',
      '#JujutsuKaisen', '#MyHeroAcademia', '#Bleach', '#DragonBall',
      '#AMV', '#AnimeEdit', '#Gear5', '#Gojo'
    ];

    final trendingAudio = [
      'We Are! - One Piece OP',
      'Unravel - Tokyo Ghoul OP',
      'Gurenge - Demon Slayer OP',
      'The Rumbling - AOT OP',
    ];

    return Scaffold(
      backgroundColor: const Color(0xFF0a0a14),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: const Text(
          'Discover',
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
        ),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Search Bar
            _buildSearchBar(),
            const SizedBox(height: 24),
            
            // Trending Hashtags
            const Text(
              'Trending Hashtags',
              style: TextStyle(
                color: Colors.white,
                fontSize: 20,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 16),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              children: trendingHashtags.map((tag) => _buildHashtagChip(tag)).toList(),
            ),
            const SizedBox(height: 32),
            
            // Trending Audio
            const Text(
              'Trending Audio',
              style: TextStyle(
                color: Colors.white,
                fontSize: 20,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 16),
            ...trendingAudio.map((audio) => _buildAudioTile(audio)),
          ],
        ),
      ),
    );
  }

  Widget _buildSearchBar() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: TextField(
        style: const TextStyle(color: Colors.white),
        decoration: InputDecoration(
          hintText: 'Search anime, hashtags, audio...',
          hintStyle: TextStyle(color: Colors.white.withOpacity(0.5)),
          icon: const Icon(Icons.search, color: Colors.cyan),
          border: InputBorder.none,
        ),
      ),
    );
  }

  Widget _buildHashtagChip(String tag) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [Colors.cyan.withOpacity(0.3), Colors.purple.withOpacity(0.3)],
        ),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        tag,
        style: const TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  Widget _buildAudioTile(String audio) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.05),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Container(
            width: 50,
            height: 50,
            decoration: BoxDecoration(
              color: Colors.cyan.withOpacity(0.2),
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Icon(Icons.music_note, color: Colors.cyan),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Text(
              audio,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 16,
              ),
            ),
          ),
          IconButton(
            onPressed: () {},
            icon: const Icon(Icons.play_arrow, color: Colors.cyan),
          ),
        ],
      ),
    );
  }
}
