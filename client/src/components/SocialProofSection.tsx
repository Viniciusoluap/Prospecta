import { ChevronRight } from "lucide-react";

export default function SocialProofSection() {
  // Seção Redes Sociais - Portfólio Digital
  return (
    <section className="py-16 bg-gradient-to-br from-background via-primary/5 to-background">
      <div className="container">
        <div className="text-center mb-10">
          <h2 className="text-3xl md:text-4xl font-bold mb-3 text-secondary">
            Veja Com Seus Próprios Olhos
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Mais de <span className="text-primary font-bold">100 casas entregues</span> documentadas em vídeo. 
            Cada projeto conta uma história de transformação.
          </p>
        </div>
    
        <div className="max-w-5xl mx-auto">
          {/* Texto PNL */}
          <div className="text-center mb-8 px-4">
            <p className="text-muted-foreground leading-relaxed">
              <span className="text-secondary font-semibold">Imagine</span> poder acompanhar cada etapa da construção, 
              ver os detalhes do acabamento e ouvir diretamente de quem já realizou o sonho da casa própria. 
              <span className="text-primary font-semibold">Agora você pode.</span>
            </p>
            <p className="text-muted-foreground mt-3">
              Nossos canais mostram <span className="font-semibold">tudo</span>: obras em andamento, casas finalizadas, 
              depoimentos reais e dicas exclusivas sobre financiamento. 
              <span className="text-secondary font-semibold">A transparência que você merece.</span>
            </p>
          </div>

          {/* Cards das Redes Sociais */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* YouTube */}
            <a 
              href="https://youtube.com/@vinigfreitas" 
              target="_blank" 
              rel="noopener noreferrer"
              className="group block"
            >
              <div className="bg-white rounded-xl border-2 border-red-500/30 hover:border-red-500 transition-all p-6 hover:shadow-lg hover:shadow-red-500/10">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-14 h-14 bg-red-500 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                    <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-secondary group-hover:text-red-500 transition-colors">YouTube</h3>
                    <p className="text-sm text-muted-foreground">@vinigfreitas</p>
                  </div>
                </div>
                <p className="text-muted-foreground text-sm mb-4">
                  <span className="font-semibold text-secondary">Vídeos completos</span> de todas as obras, 
                  tours pelas casas finalizadas e conteúdo exclusivo sobre investimentos imobiliários.
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Clique para conhecer o canal</span>
                  <ChevronRight className="h-5 w-5 text-red-500 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </a>

            {/* Instagram */}
            <a 
              href="https://www.instagram.com/viniciusincorporador" 
              target="_blank" 
              rel="noopener noreferrer"
              className="group block"
            >
              <div className="bg-white rounded-xl border-2 border-pink-500/30 hover:border-pink-500 transition-all p-6 hover:shadow-lg hover:shadow-pink-500/10">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-14 h-14 bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                    <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-secondary group-hover:text-pink-500 transition-colors">Instagram</h3>
                    <p className="text-sm text-muted-foreground">@viniciusincorporador</p>
                  </div>
                </div>
                <p className="text-muted-foreground text-sm mb-4">
                  <span className="font-semibold text-secondary">Bastidores das obras</span>, 
                  stories diários, reels com dicas rápidas e interação direta com nossa equipe.
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Clique para seguir</span>
                  <ChevronRight className="h-5 w-5 text-pink-500 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </a>
          </div>

          {/* Vídeos em Destaque do YouTube */}
          <div className="mt-12">
            <h3 className="text-xl font-bold text-secondary text-center mb-6">
              <span className="text-red-500">Vídeos</span> em Destaque
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Vídeo 1 */}
              <a 
                href="https://www.youtube.com/watch?v=u2aKrBnq_dU" 
                target="_blank" 
                rel="noopener noreferrer"
                className="group relative aspect-video rounded-lg overflow-hidden shadow-md hover:shadow-xl transition-all"
              >
                <img 
                  src="https://img.youtube.com/vi/u2aKrBnq_dU/mqdefault.jpg" 
                  alt="Casa própria em Imperatriz" 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  <div className="w-12 h-12 bg-red-500 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                    <svg className="w-5 h-5 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  </div>
                </div>
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                  <p className="text-white text-xs font-medium truncate">Casa própria em Imperatriz</p>
                  <p className="text-white/70 text-xs">1K views</p>
                </div>
              </a>

              {/* Vídeo 2 */}
              <a 
                href="https://www.youtube.com/shorts/sUKLiYMfFaE" 
                target="_blank" 
                rel="noopener noreferrer"
                className="group relative aspect-video rounded-lg overflow-hidden shadow-md hover:shadow-xl transition-all"
              >
                <img 
                  src="https://img.youtube.com/vi/sUKLiYMfFaE/mqdefault.jpg" 
                  alt="Casa 45m² Imperatriz" 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  <div className="w-12 h-12 bg-red-500 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                    <svg className="w-5 h-5 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  </div>
                </div>
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                  <p className="text-white text-xs font-medium truncate">Casa 45m² Imperatriz</p>
                  <p className="text-white/70 text-xs">Shorts</p>
                </div>
              </a>

              {/* Vídeo 3 */}
              <a 
                href="https://www.youtube.com/shorts/ILCOWiUJTBM" 
                target="_blank" 
                rel="noopener noreferrer"
                className="group relative aspect-video rounded-lg overflow-hidden shadow-md hover:shadow-xl transition-all"
              >
                <img 
                  src="https://img.youtube.com/vi/ILCOWiUJTBM/mqdefault.jpg" 
                  alt="Casa 50m² Canaã" 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  <div className="w-12 h-12 bg-red-500 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                    <svg className="w-5 h-5 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  </div>
                </div>
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                  <p className="text-white text-xs font-medium truncate">Casa 50m² Canaã</p>
                  <p className="text-white/70 text-xs">Shorts</p>
                </div>
              </a>

              {/* Vídeo 4 */}
              <a 
                href="https://www.youtube.com/shorts/5wQWuppuLwM" 
                target="_blank" 
                rel="noopener noreferrer"
                className="group relative aspect-video rounded-lg overflow-hidden shadow-md hover:shadow-xl transition-all"
              >
                <img 
                  src="https://img.youtube.com/vi/5wQWuppuLwM/mqdefault.jpg" 
                  alt="Investidor ROI 78,5%" 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  <div className="w-12 h-12 bg-red-500 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                    <svg className="w-5 h-5 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  </div>
                </div>
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                  <p className="text-white text-xs font-medium truncate">Investidor ROI 78,5%</p>
                  <p className="text-white/70 text-xs">Shorts</p>
                </div>
              </a>
            </div>
          </div>

          {/* Feed do Instagram - Preview */}
          <div className="mt-12">
            <h3 className="text-xl font-bold text-secondary text-center mb-6">
              <span className="bg-gradient-to-r from-purple-500 via-pink-500 to-orange-400 bg-clip-text text-transparent">Instagram</span> Feed
            </h3>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
              {/* Post 1 */}
              <a 
                href="https://www.instagram.com/viniciusincorporador" 
                target="_blank" 
                rel="noopener noreferrer"
                className="group relative aspect-square rounded-lg overflow-hidden shadow-md hover:shadow-xl transition-all"
              >
                <img 
                  src="https://img.youtube.com/vi/sUKLiYMfFaE/mqdefault.jpg" 
                  alt="Post Instagram" 
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073z"/>
                  </svg>
                </div>
              </a>
              {/* Post 2 */}
              <a 
                href="https://www.instagram.com/viniciusincorporador" 
                target="_blank" 
                rel="noopener noreferrer"
                className="group relative aspect-square rounded-lg overflow-hidden shadow-md hover:shadow-xl transition-all"
              >
                <img 
                  src="https://img.youtube.com/vi/ILCOWiUJTBM/mqdefault.jpg" 
                  alt="Post Instagram" 
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073z"/>
                  </svg>
                </div>
              </a>
              {/* Post 3 */}
              <a 
                href="https://www.instagram.com/viniciusincorporador" 
                target="_blank" 
                rel="noopener noreferrer"
                className="group relative aspect-square rounded-lg overflow-hidden shadow-md hover:shadow-xl transition-all"
              >
                <img 
                  src="https://img.youtube.com/vi/5wQWuppuLwM/mqdefault.jpg" 
                  alt="Post Instagram" 
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073z"/>
                  </svg>
                </div>
              </a>
              {/* Post 4 */}
              <a 
                href="https://www.instagram.com/viniciusincorporador" 
                target="_blank" 
                rel="noopener noreferrer"
                className="group relative aspect-square rounded-lg overflow-hidden shadow-md hover:shadow-xl transition-all"
              >
                <img 
                  src="https://img.youtube.com/vi/u2aKrBnq_dU/mqdefault.jpg" 
                  alt="Post Instagram" 
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073z"/>
                  </svg>
                </div>
              </a>
              {/* Post 5 */}
              <a 
                href="https://www.instagram.com/viniciusincorporador" 
                target="_blank" 
                rel="noopener noreferrer"
                className="group relative aspect-square rounded-lg overflow-hidden shadow-md hover:shadow-xl transition-all hidden md:block"
              >
                <div className="w-full h-full bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 flex items-center justify-center">
                  <div className="text-center text-white p-2">
                    <svg className="w-8 h-8 mx-auto mb-1" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073z"/>
                    </svg>
                    <p className="text-xs font-bold">Ver mais</p>
                  </div>
                </div>
              </a>
              {/* Post 6 - Ver mais */}
              <a 
                href="https://www.instagram.com/viniciusincorporador" 
                target="_blank" 
                rel="noopener noreferrer"
                className="group relative aspect-square rounded-lg overflow-hidden shadow-md hover:shadow-xl transition-all hidden md:block"
              >
                <div className="w-full h-full bg-secondary flex items-center justify-center">
                  <div className="text-center text-white p-2">
                    <ChevronRight className="w-8 h-8 mx-auto mb-1" />
                    <p className="text-xs font-bold">Seguir</p>
                  </div>
                </div>
              </a>
            </div>
          </div>

          {/* CTA Final */}
          <div className="text-center mt-8">
            <p className="text-sm text-muted-foreground">
              <span className="text-primary font-semibold">Dica:</span> Siga nossos canais para receber novidades em primeira mão 
              e não perder nenhuma oportunidade!
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
