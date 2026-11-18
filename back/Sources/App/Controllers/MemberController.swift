import Fluent
import Vapor

struct MemberController: RouteCollection {
    func boot(routes: any RoutesBuilder) throws {
        let members = routes.grouped("members")
        members.get(use: index)
        members.post(use: create)
        members.get(":memberID", use: show)
        members.put(":memberID", use: update)
        members.delete(":memberID", use: delete)
    }
    
    // Fonction qui affiche la liste des adherants
    @Sendable
    func index(req: Request) async throws -> [MemberDTO] {
        try await Member.query(on: req.db).all().map { $0.toDTO() }
    }
    
    // Fonction qui permet de créer un adherant en verifiant les validation du dto sur name et email (unicité).
    @Sendable
    func create(req: Request) async throws -> Response {
        try CreateMemberDTO.validate(content: req)
        let dto = try req.content.decode(CreateMemberDTO.self)
        
        let emailTaken = try await Member.query(on: req.db)
            .filter(\.$email == dto.email)
            .count() > 0
        guard !emailTaken else {
            throw Abort(.conflict, reason: "A member with this email already exists")
        }
        
        let member = dto.toModel()
        try await member.save(on: req.db)
        return try await member.toDTO().encodeResponse(status: .created, for: req)
    }
    
    // Fonction qui permet d'afficher les infos d'un utilisatuer via son id
    @Sendable
    func show(req: Request) async throws -> MemberDTO {
        guard let memberID = req.parameters.get("memberID", as: UUID.self) else {
            throw Abort(.badRequest, reason: "Invalid member id")
        }
        guard let member = try await Member.find(memberID, on: req.db) else {
            throw Abort(.notFound, reason: "Member not found")
        }
        return member.toDTO()
    }
    
    // // Fonction qui pour trouver un adhérant spécifique
    private func findMember(req: Request) async throws -> Member {
        guard let memberID = req.parameters.get("memberID", as: UUID.self) else {
            throw Abort(.badRequest, reason: "Invalid member id")
        }
        guard let member = try await Member.query(on: req.db)
            .filter(\.$id == memberID)
            .with(\.$loans)
            .first() else {
            throw Abort(.notFound, reason: "Member not found")
        }
        return member
    }
    
    // Fonction qui permet de modifier nom/email adhérant
    @Sendable
    func update(req: Request) async throws -> Response {
        try CreateMemberDTO.validate(content: req)
        let dto = try req.content.decode(CreateMemberDTO.self)
        
        // Gere automatiquement  les erreurs 400 et 404 dans la recherche du jeu
        let member = try await findMember(req: req)
        
        let existingMemberWithEmail = try await Member.query(on: req.db)
            .filter(\.$email == dto.email)
            .first()
        
        if let existingMember = existingMemberWithEmail, existingMember.id !=  member.id {
            throw Abort(.conflict, reason: "A member with this email already exists ")
        }
        
        member.name = dto.name
        member.email = dto.email
        
        try await member.update(on: req.db)
        return try await member.toDTO().encodeResponse(status: .ok, for: req)
    }
    
    // Fonction qui permet de supprimer un adhérent
    @Sendable
    func delete(req: Request) async throws -> HTTPStatus {
        
        let member = try await findMember(req: req)
        
        if !member.loans.isEmpty {
            throw Abort(.conflict, reason: "A member with loans cannot be deleted")
        }
        
        try await member.delete(on: req.db)
        
        return .noContent
    }
}
