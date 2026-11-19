import Fluent
import Vapor

struct LoanController: RouteCollection {
    func boot(routes: any RoutesBuilder) throws {
        let loans = routes.grouped("loans")
        loans.post(use: create)
        loans.post(":id", "return", use: returnGame)
        loans.get(use: index)
    }

    // Fonction permettant de faire un emprunt en verifiant que le jeu ou l'adherant existe bien.
    // Rien n'est mis en place pour s'assurer de la disponibilité du jeu
    @Sendable
    func create(req: Request) async throws -> Response {
        let dto = try req.content.decode(CreateLoanDTO.self)

        guard let game = try await Game.find(dto.gameID, on: req.db) else {
            throw Abort(.notFound, reason: "Game not found")
        }
        guard let member = try await Member.find(dto.memberID, on: req.db) else {
            throw Abort(.notFound, reason: "Member not found")
        }
        let existingLoan = try await Loan.query(on: req.db)
            .filter(\.$game.$id == dto.gameID)
            .filter(\.$returnedAt == nil)
            .first()
        
        if existingLoan != nil {
            throw Abort(.conflict, reason: "Game is already on loan")
        }

        let now = Date()
        let loan = Loan(
            gameID: try game.requireID(),
            memberID: try member.requireID(),
            borrowedAt: now,
            dueAt: try Loan.dueDate(from: now)
        )
        try await loan.save(on: req.db)
        return try await loan.toDTO().encodeResponse(status: .created, for: req)
    }
    
    @Sendable
    func returnGame (req: Request) async throws -> Response {
        guard let loanID = req.parameters.get("id", as: UUID.self) else {
            throw Abort(.badRequest, reason: "Invalid loan ID")
        }

        guard let loan = try await Loan.find(loanID, on: req.db) else {
            throw Abort(.notFound, reason: "Loan not found")
        }

        if loan.returnedAt != nil {
            throw Abort(.conflict, reason: "Loan has already been returned")
        }

        loan.returnedAt = Date()
        try await loan.save(on: req.db)

        return try await loan.toDTO().encodeResponse(status: .ok, for: req)
    }
    
    @Sendable
        func index(req: Request) async throws -> [LoanDTO] {
            let loans = try await Loan.query(on: req.db).all()
            
            for loan in loans {
                try await loan.$game.load(on: req.db)
                try await loan.$member.load(on: req.db)
            }
            
            return loans.map { $0.toDTO() }
        }
}
