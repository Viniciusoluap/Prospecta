import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { trpc } from "@/lib/trpc";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Loader2, User, Save, Camera, CheckCircle, XCircle } from "lucide-react";
import { useLocation } from "wouter";
import { getLoginUrl } from "@/const";

const ESTADOS_BRASIL = [
  { value: "AC", label: "Acre" },
  { value: "AL", label: "Alagoas" },
  { value: "AP", label: "Amapá" },
  { value: "AM", label: "Amazonas" },
  { value: "BA", label: "Bahia" },
  { value: "CE", label: "Ceará" },
  { value: "DF", label: "Distrito Federal" },
  { value: "ES", label: "Espírito Santo" },
  { value: "GO", label: "Goiás" },
  { value: "MA", label: "Maranhão" },
  { value: "MT", label: "Mato Grosso" },
  { value: "MS", label: "Mato Grosso do Sul" },
  { value: "MG", label: "Minas Gerais" },
  { value: "PA", label: "Pará" },
  { value: "PB", label: "Paraíba" },
  { value: "PR", label: "Paraná" },
  { value: "PE", label: "Pernambuco" },
  { value: "PI", label: "Piauí" },
  { value: "RJ", label: "Rio de Janeiro" },
  { value: "RN", label: "Rio Grande do Norte" },
  { value: "RS", label: "Rio Grande do Sul" },
  { value: "RO", label: "Rondônia" },
  { value: "RR", label: "Roraima" },
  { value: "SC", label: "Santa Catarina" },
  { value: "SP", label: "São Paulo" },
  { value: "SE", label: "Sergipe" },
  { value: "TO", label: "Tocantins" },
];

// Função de validação de CPF
function cleanCPF(cpf: string): string {
  return cpf.replace(/\D/g, "");
}

function validateCPF(cpf: string): { valid: boolean; message: string } {
  const numbers = cleanCPF(cpf);
  
  if (numbers.length !== 11) {
    return { valid: false, message: "CPF deve ter 11 dígitos" };
  }
  
  const invalidSequences = [
    "00000000000", "11111111111", "22222222222", "33333333333",
    "44444444444", "55555555555", "66666666666", "77777777777",
    "88888888888", "99999999999",
  ];
  
  if (invalidSequences.includes(numbers)) {
    return { valid: false, message: "CPF inválido" };
  }
  
  // Primeiro dígito verificador
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(numbers[i]) * (10 - i);
  }
  let remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  
  if (remainder !== parseInt(numbers[9])) {
    return { valid: false, message: "CPF inválido" };
  }
  
  // Segundo dígito verificador
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(numbers[i]) * (11 - i);
  }
  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  
  if (remainder !== parseInt(numbers[10])) {
    return { valid: false, message: "CPF inválido" };
  }
  
  return { valid: true, message: "CPF válido" };
}

export default function Perfil() {
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    cpf: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    zipCode: "",
  });
  
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [cpfValidation, setCpfValidation] = useState<{ valid: boolean; message: string } | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  // Redirecionar se não autenticado
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      window.location.href = getLoginUrl();
    }
  }, [authLoading, isAuthenticated]);

  // Carregar dados do usuário
  useEffect(() => {
    if (user) {
      setFormData({
        name: user.name || "",
        email: user.email || "",
        cpf: user.cpf || "",
        phone: user.phone || "",
        address: user.address || "",
        city: user.city || "",
        state: user.state || "",
        zipCode: user.zipCode || "",
      });
      
      // Validar CPF existente
      if (user.cpf && cleanCPF(user.cpf).length === 11) {
        setCpfValidation(validateCPF(user.cpf));
      }
    }
  }, [user]);

  const updateProfileMutation = trpc.user.updateProfile.useMutation({
    onSuccess: () => {
      toast.success("Perfil atualizado com sucesso!");
      setIsSaving(false);
      utils.auth.me.invalidate();
    },
    onError: (error: { message: string }) => {
      toast.error("Erro ao atualizar perfil: " + error.message);
      setIsSaving(false);
    },
  });

  const uploadAvatarMutation = trpc.user.uploadAvatar.useMutation({
    onSuccess: (data) => {
      toast.success("Foto de perfil atualizada!");
      setIsUploadingAvatar(false);
      setAvatarPreview(null);
      utils.auth.me.invalidate();
    },
    onError: (error: { message: string }) => {
      toast.error("Erro ao enviar foto: " + error.message);
      setIsUploadingAvatar(false);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validar CPF antes de enviar
    if (formData.cpf && cleanCPF(formData.cpf).length === 11) {
      const validation = validateCPF(formData.cpf);
      if (!validation.valid) {
        toast.error(validation.message);
        return;
      }
    }
    
    setIsSaving(true);
    updateProfileMutation.mutate(formData);
  };

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // Formatar CPF e validar em tempo real
  const formatCPF = (value: string) => {
    const numbers = value.replace(/\D/g, "");
    if (numbers.length <= 3) return numbers;
    if (numbers.length <= 6) return `${numbers.slice(0, 3)}.${numbers.slice(3)}`;
    if (numbers.length <= 9) return `${numbers.slice(0, 3)}.${numbers.slice(3, 6)}.${numbers.slice(6)}`;
    return `${numbers.slice(0, 3)}.${numbers.slice(3, 6)}.${numbers.slice(6, 9)}-${numbers.slice(9, 11)}`;
  };

  const handleCPFChange = (value: string) => {
    const formatted = formatCPF(value);
    handleChange("cpf", formatted);
    
    // Validar quando tiver 11 dígitos
    const numbers = cleanCPF(formatted);
    if (numbers.length === 11) {
      setCpfValidation(validateCPF(formatted));
    } else if (numbers.length > 0) {
      setCpfValidation(null);
    } else {
      setCpfValidation(null);
    }
  };

  // Formatar telefone
  const formatPhone = (value: string) => {
    const numbers = value.replace(/\D/g, "");
    if (numbers.length <= 2) return numbers;
    if (numbers.length <= 7) return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
    if (numbers.length <= 11) return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7, 11)}`;
  };

  // Formatar CEP
  const formatCEP = (value: string) => {
    const numbers = value.replace(/\D/g, "");
    if (numbers.length <= 5) return numbers;
    return `${numbers.slice(0, 5)}-${numbers.slice(5, 8)}`;
  };

  // Handler para seleção de arquivo de avatar
  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Validar tipo de arquivo
    if (!file.type.startsWith("image/")) {
      toast.error("Por favor, selecione uma imagem válida");
      return;
    }
    
    // Validar tamanho (máx 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error("A imagem deve ter no máximo 5MB");
      return;
    }
    
    // Criar preview
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setAvatarPreview(base64);
      
      // Fazer upload automaticamente
      setIsUploadingAvatar(true);
      uploadAvatarMutation.mutate({
        imageBase64: base64,
        mimeType: file.type,
      });
    };
    reader.readAsDataURL(file);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#1A2332]">
        <Loader2 className="w-8 h-8 animate-spin text-[#C9A961]" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1A2332] to-[#0f1419] py-12">
      <div className="container max-w-2xl mx-auto px-4">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Meu Perfil</h1>
          <p className="text-gray-400">Gerencie suas informações pessoais</p>
        </div>

        {/* Avatar Section */}
        <Card className="bg-[#1e2a3a] border-[#2a3a4a] mb-6">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <Avatar className="w-24 h-24 border-4 border-[#C9A961]">
                  <AvatarImage src={avatarPreview || user?.avatarUrl || undefined} />
                  <AvatarFallback className="bg-[#C9A961] text-[#1A2332] text-2xl font-bold">
                    {user?.name?.charAt(0)?.toUpperCase() || <User className="w-10 h-10" />}
                  </AvatarFallback>
                </Avatar>
                
                {/* Input de arquivo oculto */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarSelect}
                />
                
                {/* Botão de câmera */}
                <button 
                  className="absolute bottom-0 right-0 bg-[#C9A961] p-2 rounded-full hover:bg-[#b8984f] transition-colors disabled:opacity-50"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingAvatar}
                >
                  {isUploadingAvatar ? (
                    <Loader2 className="w-4 h-4 text-[#1A2332] animate-spin" />
                  ) : (
                    <Camera className="w-4 h-4 text-[#1A2332]" />
                  )}
                </button>
              </div>
              <div className="text-center">
                <h2 className="text-xl font-semibold text-white">{user?.name || "Usuário"}</h2>
                <p className="text-gray-400 text-sm">{user?.email}</p>
                <p className="text-xs text-gray-500 mt-1">Clique na câmera para alterar a foto</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Profile Form */}
        <Card className="bg-[#1e2a3a] border-[#2a3a4a]">
          <CardHeader>
            <CardTitle className="text-white">Informações Pessoais</CardTitle>
            <CardDescription className="text-gray-400">
              Mantenha seus dados atualizados para facilitar pagamentos e entregas
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Nome e Email */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-gray-300">Nome Completo</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => handleChange("name", e.target.value)}
                    placeholder="Seu nome completo"
                    className="bg-[#2a3a4a] border-[#3a4a5a] text-white placeholder:text-gray-500"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-gray-300">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleChange("email", e.target.value)}
                    placeholder="seu@email.com"
                    className="bg-[#2a3a4a] border-[#3a4a5a] text-white placeholder:text-gray-500"
                  />
                </div>
              </div>

              {/* CPF e Telefone */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="cpf" className="text-gray-300">CPF</Label>
                  <div className="relative">
                    <Input
                      id="cpf"
                      value={formData.cpf}
                      onChange={(e) => handleCPFChange(e.target.value)}
                      placeholder="000.000.000-00"
                      maxLength={14}
                      className={`bg-[#2a3a4a] border-[#3a4a5a] text-white placeholder:text-gray-500 pr-10 ${
                        cpfValidation 
                          ? cpfValidation.valid 
                            ? "border-green-500" 
                            : "border-red-500"
                          : ""
                      }`}
                    />
                    {cpfValidation && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        {cpfValidation.valid ? (
                          <CheckCircle className="w-5 h-5 text-green-500" />
                        ) : (
                          <XCircle className="w-5 h-5 text-red-500" />
                        )}
                      </div>
                    )}
                  </div>
                  <p className={`text-xs ${cpfValidation?.valid === false ? "text-red-400" : "text-gray-500"}`}>
                    {cpfValidation?.valid === false ? cpfValidation.message : "Necessário para pagamentos"}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone" className="text-gray-300">Telefone</Label>
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => handleChange("phone", formatPhone(e.target.value))}
                    placeholder="(00) 00000-0000"
                    maxLength={15}
                    className="bg-[#2a3a4a] border-[#3a4a5a] text-white placeholder:text-gray-500"
                  />
                </div>
              </div>

              {/* Endereço */}
              <div className="space-y-2">
                <Label htmlFor="address" className="text-gray-300">Endereço</Label>
                <Textarea
                  id="address"
                  value={formData.address}
                  onChange={(e) => handleChange("address", e.target.value)}
                  placeholder="Rua, número, complemento, bairro"
                  rows={2}
                  className="bg-[#2a3a4a] border-[#3a4a5a] text-white placeholder:text-gray-500 resize-none"
                />
              </div>

              {/* Cidade, Estado e CEP */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="city" className="text-gray-300">Cidade</Label>
                  <Input
                    id="city"
                    value={formData.city}
                    onChange={(e) => handleChange("city", e.target.value)}
                    placeholder="Sua cidade"
                    className="bg-[#2a3a4a] border-[#3a4a5a] text-white placeholder:text-gray-500"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="state" className="text-gray-300">Estado</Label>
                  <Select value={formData.state} onValueChange={(value) => handleChange("state", value)}>
                    <SelectTrigger className="bg-[#2a3a4a] border-[#3a4a5a] text-white">
                      <SelectValue placeholder="UF" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#2a3a4a] border-[#3a4a5a]">
                      {ESTADOS_BRASIL.map((estado) => (
                        <SelectItem key={estado.value} value={estado.value} className="text-white hover:bg-[#3a4a5a]">
                          {estado.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="zipCode" className="text-gray-300">CEP</Label>
                  <Input
                    id="zipCode"
                    value={formData.zipCode}
                    onChange={(e) => handleChange("zipCode", formatCEP(e.target.value))}
                    placeholder="00000-000"
                    maxLength={9}
                    className="bg-[#2a3a4a] border-[#3a4a5a] text-white placeholder:text-gray-500"
                  />
                </div>
              </div>

              {/* Submit Button */}
              <div className="flex justify-end pt-4">
                <Button
                  type="submit"
                  disabled={isSaving || (cpfValidation?.valid === false)}
                  className="bg-[#C9A961] hover:bg-[#b8984f] text-[#1A2332] font-semibold px-8"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Salvar Alterações
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Back Button */}
        <div className="mt-6 text-center">
          <Button
            variant="ghost"
            onClick={() => navigate("/meu-saldo")}
            className="text-gray-400 hover:text-white"
          >
            ← Voltar para Meu Saldo
          </Button>
        </div>
      </div>
    </div>
  );
}
